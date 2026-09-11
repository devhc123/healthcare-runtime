# -*- coding: utf-8 -*-
"""
康养智能体 runtime — 确定性临床风险评分引擎 (calculator registry)

设计原则:
- 评分是确定性的、带版本、输入经过 schema 校验(缺失/单位/时间窗处理)。
- Agent 决不心算临床分数;只负责选择计算器、提取参数、解释结果。
- 新增计算器:在此文件注册一个带 `meta` + `calc(**)` 的函数即可,
  自动出现在 `/calculators` 与 `calculate` 入口。
"""

REGISTRY = {}


def register(calc_id, name, version, inputs, risk_levels=None, reference=None):
    """装饰器:注册一个评分器。inputs: list[(key, label, type, required, note)]"""
    def deco(fn):
        REGISTRY[calc_id] = {
            "id": calc_id,
            "name": name,
            "version": version,
            "inputs": inputs,
            "risk_levels": risk_levels or [],
            "reference": reference or "",
            "fn": fn,
        }
        return fn
    return deco


def _to_float(v):
    if v is None or v == "":
        return None
    f = float(v)
    return f


# ----------------------------------------------------------------------------
# Wells 评分 (DVT, 简化版 — 见 New England Journal of Medicine 1997)
# ----------------------------------------------------------------------------
WELLS_INPUTS = [
    ("active_cancer", "活动性肿瘤(6个月内治疗或姑息)", "bool", True, ""),
    ("paralysis", "下肢瘫痪/近期石膏固定", "bool", True, ""),
    ("bedridden", "卧床>3天 或 大手术后4周内", "bool", True, ""),
    ("tender_calf", "沿深静脉走行区域性压痛", "bool", True, ""),
    ("swollen_leg", "全下肢肿胀", "bool", True, ""),
    ("calf_swell_gt3", "小腿肿胀较对侧>3cm", "bool", True, ""),
    ("pitting_edema", "凹陷性水肿(仅症状侧)", "bool", True, ""),
    ("collateral_veins", "浅静脉侧支循环(非静脉曲张)", "bool", True, ""),
    ("alt_diagnosis", "有与DVT同样可能或更可能的鉴别诊断", "bool", False, "评分中会据此判断概率(是=-2分;否=+3分)"),
]

WELLS_WEIGHTS = {
    "active_cancer": 1,
    "paralysis": 1,
    "bedridden": 1,
    "tender_calf": 1,
    "swollen_leg": 1,
    "calf_swell_gt3": 1,
    "pitting_edema": 1,
    "collateral_veins": 1,
}


@register(
    "wells-dvt",
    "Wells 评分 — 深静脉血栓(DVT)临床概率",
    version="1.0.0",
    inputs=WELLS_INPUTS,
    risk_levels=[
        {"label": "低危", "op": "<=", "value": 0},
        {"label": "中危", "op": "<=", "value": 1},
        {"label": "高危", "op": ">", "value": 1},
    ],
    reference="Wells PS et al. NEJM 1997;338:1089 (DVT 简化评分)",
)
def calc_wells_dvt(**kwargs):
    score = 0.0
    filled = {}
    missing = []
    for key, _label, _typ, req, _note in WELLS_INPUTS:
        val = kwargs.get(key)
        if val is None or val == "":
            if req:
                missing.append(key)
            continue
        b = bool(val) if isinstance(val, bool) else str(val).strip().lower() in ("1", "true", "yes", "y", "是")
        filled[key] = b
        if key == "alt_diagnosis":
            score += -2 if b else 3
        else:
            score += WELLS_WEIGHTS.get(key, 0) * (1 if b else 0)
    if missing:
        return {
            "score": None,
            "probability": None,
            "risk": "INSUFFICIENT",
            "missing": missing,
            "scores": {"wells_score": None},
            "note": "缺少必填输入,无法评分。请补充: " + ", ".join(missing),
        }
    prob = (
        "低(约5%)" if score <= 0 else
        "中(约17%)" if score == 1 else
        "高(约53%)"
    )
    risk = "低危" if score == 0 else "中危" if score == 1 else "高危"
    return {
        "score": score,
        "probability": prob,
        "risk": risk,
        "missing": [],
        "scores": {"wells_score": score},
    }


# ----------------------------------------------------------------------------
# HEART 评分 — 非ST段抬高型 ACS 风险分层
# ----------------------------------------------------------------------------
HEART_INPUTS = [
    ("history", "病史", "int", True, "0=高度怀疑 2=中等 0分=轻/无"),
    ("ecg", "心电图", "int", True, "2=明显ST段改变 1=非特异性 0=正常"),
    ("age", "年龄", "int", True, "2=>=65岁 1=45-64岁 0=<45岁"),
    ("risk_factors", "危险因素", "int", True, "2=>=3个或已知冠脉疾病 1=1-2个 0=无"),
    ("troponin", "肌钙蛋白", "int", True, "2=>=3倍正常上限 1=1-3倍 0=正常"),
]


@register(
    "heart-score",
    "HEART 评分 — 急诊胸痛 ACS 风险分层",
    version="1.1.0",
    inputs=HEART_INPUTS,
    risk_levels=[
        {"label": "低危", "op": "<=", "value": 3},
        {"label": "中危", "op": "<=", "value": 6},
        {"label": "高危", "op": ">", "value": 6},
    ],
    reference="Six AJ et al. Int J Cardiol 2008;128:308 (HEART score)",
)
def calc_heart(**kwargs):
    missing = []
    total = 0
    parts = {}
    for key, _label, _typ, req, _note in HEART_INPUTS:
        val = kwargs.get(key)
        if val is None or val == "":
            if req:
                missing.append(key)
            continue
        try:
            n = int(val)
        except (TypeError, ValueError):
            return {"score": None, "missing": [], "error": f"{key} 必须是整数", "risk": "ERROR"}
        if n < 0 or n > 2:
            return {"score": None, "missing": [], "error": f"{key} 必须为 0..2", "risk": "ERROR"}
        total += n
        parts[key] = n
    if missing:
        return {
            "score": None,
            "risk": "INSUFFICIENT",
            "missing": missing,
            "scores": {"heart_score": None},
            "note": "缺少必填输入: " + ", ".join(missing),
        }
    risk = "低危(可考虑门诊/观察)" if total <= 3 else "中危(入院观察)" if total <= 6 else "高危(紧急干预)"
    return {"score": total, "risk": risk, "missing": [], "scores": {"heart_score": total}, "components": parts}


# ----------------------------------------------------------------------------
# CHA2DS2-VASc — 房颤卒中风险
# ----------------------------------------------------------------------------
CHADS_INPUTS = [
    ("chf", "充血性心衰/左室功能不全", "bool", True, ""),
    ("hypertension", "高血压", "bool", True, ""),
    ("age_gt74", "年龄>=75", "bool", True, ""),
    ("diabetes", "糖尿病", "bool", True, ""),
    ("stroke_tia", "卒中/TIA/血栓栓塞史", "bool", True, ""),
    ("vascular", "血管疾病(心梗/外周动脉/主动脉斑块)", "bool", True, ""),
    ("age_65_74", "年龄65-74", "bool", True, ""),
    ("sex_female", "性别为女性", "bool", True, ""),
]


@register(
    "cha2ds2-vasc",
    "CHA2DS2-VASc 评分 — 房颤卒中风险",
    version="1.0.0",
    inputs=CHADS_INPUTS,
    risk_levels=[
        {"label": "低危", "op": "==", "value": 0},
        {"label": "需评估抗凝", "op": ">=", "value": 1},
    ],
    reference="Lip GY et al. Chest 2010;137:263",
)
def calc_cha2ds2_vasc(**kwargs):
    weights = {
        "chf": 1, "hypertension": 1, "diabetes": 1, "vascular": 1,
        "age_65_74": 1, "sex_female": 1, "age_gt74": 2, "stroke_tia": 2,
    }
    score = 0
    missing = []
    used = {}
    for key, _l, _t, req, _n in CHADS_INPUTS:
        val = kwargs.get(key)
        if val is None or val == "":
            if req:
                missing.append(key)
            continue
        b = bool(val) if isinstance(val, bool) else str(val).strip().lower() in ("1", "true", "yes", "y", "是")
        if b:
            score += weights[key]
            used[key] = weights[key]
    if missing:
        return {"score": None, "risk": "INSUFFICIENT", "missing": missing,
                "scores": {"cha2ds2_vasc": None}, "note": "缺少必填输入: " + ", ".join(missing)}
    risk = "低危(CHA2DS2-VASc=0)" if score == 0 else "建议评估口服抗凝"
    return {"score": score, "risk": risk, "missing": [], "scores": {"cha2ds2_vasc": score}, "components": used}


def list_calculators():
    """返回注册表元数据(不含函数),用于 /calculators"""
    return [
        {k: v for k, v in meta.items() if k != "fn"}
        for meta in REGISTRY.values()
    ]


def calculate(calc_id, inputs: dict):
    meta = REGISTRY.get(calc_id)
    if not meta:
        raise KeyError(f"未知计算器: {calc_id}")
    return meta["fn"](**inputs)


if __name__ == "__main__":
    print("calculators:", list_calculators())
