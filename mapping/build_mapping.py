import csv
import re
import unicodedata
from difflib import SequenceMatcher

BASE = "/home/franco/coderhouse"
INSUMOS = f"{BASE}/mapping/insumos"

STOPWORDS = {
    "de", "del", "la", "el", "los", "las", "y", "en", "al", "con", "para",
    "por", "su", "sus", "un", "una", "e", "o", "u",
}
ROMAN_TO_DIGIT = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6"}


def strip_accents(s):
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


DIGIT_FIRST = re.compile(r"^(\d+)([a-z]+)$")
COMISION = re.compile(r"^([a-z])(\d{1,2})$")


COMISION_PAREN = re.compile(r"\(?\s*com[.:\-]+\s*[ivx0-9]+\)?", re.IGNORECASE)


def tokens(s):
    s = strip_accents(s).lower()
    # "(com. I)"/"(com:ii)" etc. marcan comisión, no la materia: si se dejan,
    # su numeral romano choca con el numeral de la propia materia (ej.
    # "Inglés Técnico II (Com. I)" matchearía contra "Inglés Técnico I").
    s = COMISION_PAREN.sub(" ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    toks = [t for t in s.split() if t]
    out = []
    for t in toks:
        if t in ROMAN_TO_DIGIT:
            out.append(ROMAN_TO_DIGIT[t])
            continue
        if t in STOPWORDS:
            continue
        # "1b" (numeral+letra pegados, ej. "algebra 1b" = "algebra I-B"): se
        # separa en numeral + letra de variante, ambos relevantes para matchear.
        m = DIGIT_FIRST.match(t)
        if m:
            out.append(m.group(1))
            out.append(m.group(2))
            continue
        # "a1" (letra+numero pegados) es una comisión, no identifica la
        # materia: se descarta entera para no confundirla con una variante
        # de una sola letra (ej. "ÁLGEBRA A" vs "ÁLGEBRA B").
        if COMISION.match(t):
            continue
        out.append(t)
    return out


def norm_string(s):
    return " ".join(tokens(s))


def token_score(a_toks, b_toks):
    """Prefix-aware token overlap score (0..1)."""
    if not a_toks or not b_toks:
        return 0.0
    b_used = [False] * len(b_toks)

    def matched(tok, pool_toks, used):
        for i, bt in enumerate(pool_toks):
            if used[i]:
                continue
            if tok == bt or (len(tok) >= 3 and len(bt) >= 3 and (bt.startswith(tok) or tok.startswith(bt))):
                used[i] = True
                return True
        return False

    hits_a = 0
    for t in a_toks:
        if matched(t, b_toks, b_used):
            hits_a += 1
    recall = hits_a / len(a_toks)
    precision = hits_a / len(b_toks)
    if recall + precision == 0:
        return 0.0
    return 2 * recall * precision / (recall + precision)


def combined_score(a, b):
    a_toks, b_toks = tokens(a), tokens(b)
    ts = token_score(a_toks, b_toks)
    ss = SequenceMatcher(None, norm_string(a), norm_string(b)).ratio()
    # El ratio de secuencia favorece prefijos largos compartidos y no distingue
    # bien sufijos cortos que cambian de materia (I vs II vs A vs B); se usa el
    # solape de tokens como señal principal y el ratio de secuencia como desempate.
    return 0.85 * ts + 0.15 * ss, ts, ss


def apellido_from_outlook(docente):
    docente = docente.strip()
    if not docente:
        return ""
    if "," in docente:
        return docente.split(",")[0].strip()
    # "APELLIDO NOMBRE" fallback: assume last word(s) after first token(s) uppercase apellido first word
    return docente.split()[0]


def load_outlook():
    rows = list(csv.DictReader(open(f"{INSUMOS}/outlook.csv", encoding="utf-8")))
    for r in rows:
        r["_apellido"] = apellido_from_outlook(r["docente"])
        r["_apellido_norm"] = norm_string(r["_apellido"])
    return rows


def load_cursadas_campus():
    rows = list(csv.DictReader(open(f"{INSUMOS}/cursadas-ingenieria.csv", encoding="utf-8")))
    for r in rows:
        full = r["nombre completo cursada"]
        alts = [a.strip() for a in full.split("/")]
        alts_clean = []
        for a in alts:
            a_wo_plan = re.sub(r"\(plan\s*\d{4}\)", "", a, flags=re.IGNORECASE).strip()
            a_wo_code = re.sub(r"\([a-z0-9]{2,8}\)", "", a_wo_plan, flags=re.IGNORECASE).strip()
            code_match = re.findall(r"\(([a-z0-9]{2,8})\)", a_wo_plan, flags=re.IGNORECASE)
            alts_clean.append((a_wo_code, code_match))
        r["_alts"] = alts_clean
        profes = [p.strip() for p in r["profesores"].split(";") if p.strip()]
        r["_profes"] = profes
        r["_profes_apellidos_norm"] = [norm_string(p.split()[-1]) for p in profes]
    return rows


def load_aulario():
    rows = list(csv.DictReader(open(f"{INSUMOS}/horarios_aulas.csv", encoding="utf-8")))
    materias = {}
    for r in rows:
        materias.setdefault(r["materia"], []).append(r["titulo_crudo"])
    return materias


def best_outlook_match(materia, outlook_rows):
    best = None
    best_score = 0.0
    for o in outlook_rows:
        score, ts, ss = combined_score(materia, o["asignatura"])
        if score > best_score:
            best_score = score
            best = (o, ts, ss)
    return best, best_score


def best_campus_match(outlook_row, campus_rows, threshold=0.55):
    """Return list of (campus_row, alt_name, score, code_match, apellido_match) sorted desc.

    El nombre es la señal principal: código y profesor suman como refuerzo/
    desempate, pero no pueden pisar un match de nombre mucho mejor (si no, un
    apellido que aparece por coincidencia en la lista de profesores de OTRA
    materia le gana a la materia con el nombre idéntico).
    """
    candidates = []
    for c in campus_rows:
        for alt_name, codes in c["_alts"]:
            score, ts, ss = combined_score(outlook_row["asignatura"], alt_name)
            code_match = outlook_row["codigo"].strip().upper() in [x.upper() for x in codes]
            apellido_match = bool(outlook_row["_apellido_norm"]) and outlook_row["_apellido_norm"] in c["_profes_apellidos_norm"]
            boosted = score + (0.25 if code_match else 0) + (0.15 if apellido_match else 0)
            candidates.append((c, alt_name, score, code_match, apellido_match, boosted))
    candidates.sort(key=lambda x: x[5], reverse=True)
    return candidates


def main():
    outlook_rows = load_outlook()
    campus_rows = load_cursadas_campus()
    aulario_materias = load_aulario()

    mapping_out = []
    aulario_sin_match = []

    for materia, titulos in aulario_materias.items():
        (best_o, ts, ss), score = best_outlook_match(materia, outlook_rows)
        if score < 0.5:
            aulario_sin_match.append({
                "materia_aulario": materia,
                "titulo_crudo_ejemplo": titulos[0],
                "mejor_candidato_outlook": best_o["asignatura"] if best_o else "",
                "score": round(score, 3),
            })
            continue

        candidates = best_campus_match(best_o, campus_rows)
        top = candidates[0] if candidates else None
        campus_name = ""
        campus_profes = ""
        metodo = ""
        campus_score = 0.0
        if top and (top[3] or top[4] or top[2] >= 0.55):
            c, alt_name, cscore, code_match, apellido_match, _boosted = top
            campus_name = c["nombre completo cursada"]
            campus_profes = "; ".join(c["_profes"])
            campus_score = cscore
            metodo = "+".join(filter(None, [
                "codigo" if code_match else "",
                "profesor" if apellido_match else "",
                "nombre" if cscore >= 0.55 else "",
            ])) or "nombre-debil"

        mapping_out.append({
            "materia_aulario": materia,
            "titulo_crudo_ejemplo": titulos[0],
            "clases_scrapeadas": len(titulos),
            "outlook_asignatura": best_o["asignatura"],
            "outlook_codigo": best_o["codigo"],
            "outlook_docente": best_o["docente"],
            "score_aulario_outlook": round(score, 3),
            "campus_nombre_completo": campus_name,
            "campus_profesores": campus_profes,
            "score_outlook_campus": round(campus_score, 3),
            "metodo_match": metodo,
        })

    matched_campus_names = {m["campus_nombre_completo"] for m in mapping_out if m["campus_nombre_completo"]}
    campus_sin_match = [
        c for c in campus_rows if c["nombre completo cursada"] not in matched_campus_names
    ]

    with open(f"{BASE}/mapping/mapping_aulario_campus.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[
            "materia_aulario", "titulo_crudo_ejemplo", "clases_scrapeadas",
            "outlook_asignatura", "outlook_codigo", "outlook_docente",
            "score_aulario_outlook", "campus_nombre_completo", "campus_profesores",
            "score_outlook_campus", "metodo_match",
        ])
        w.writeheader()
        w.writerows(sorted(mapping_out, key=lambda r: r["materia_aulario"]))

    with open(f"{BASE}/mapping/aulario_sin_match.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[
            "materia_aulario", "titulo_crudo_ejemplo", "mejor_candidato_outlook", "score",
        ])
        w.writeheader()
        w.writerows(sorted(aulario_sin_match, key=lambda r: -r["score"]))

    with open(f"{BASE}/mapping/campus_sin_match.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["nombre_completo_cursada", "profesores", "enlace"])
        w.writeheader()
        for c in sorted(campus_sin_match, key=lambda r: r["nombre completo cursada"]):
            w.writerow({
                "nombre_completo_cursada": c["nombre completo cursada"],
                "profesores": "; ".join(c["_profes"]),
                "enlace": c["enlace a datos para matricularse"],
            })

    print("aulario materias:", len(aulario_materias))
    print("mapping filas (con outlook match):", len(mapping_out))
    print("  con campus match:", sum(1 for m in mapping_out if m["campus_nombre_completo"]))
    print("  sin campus match:", sum(1 for m in mapping_out if not m["campus_nombre_completo"]))
    print("aulario sin match a outlook:", len(aulario_sin_match))
    print("campus rows total:", len(campus_rows))
    print("campus sin match:", len(campus_sin_match))


if __name__ == "__main__":
    main()
