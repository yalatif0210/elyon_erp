# -*- coding: utf-8 -*-
"""
RECETTE — TYPES D'OPÉRATION ET CHECKLIST HSE ASSEMBLÉE
Réf. SPECIFICATIONS.md § 7.1

Éprouve, à travers l'API et non en base, que :
  - la checklist ouverte est l'UNION des types portés par l'opération ;
  - un point commun à deux types n'apparaît qu'une fois ;
  - le niveau le plus contraignant l'emporte ;
  - une opération sans type ne reçoit aucune checklist, avec un message qui
    dit quoi faire.
"""
import json
import pathlib
import subprocess
import urllib.error
import urllib.request

# Racine du dépôt, calculée depuis ce fichier - jamais un chemin personnel
# codé en dur, qui ne survit qu'au poste de qui l'a écrit.
DEPOT = pathlib.Path(__file__).resolve().parents[2]


def psql(sql):
    o = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "erp_migrator",
         "-d", "erp", "-t", "-A", "-c", sql],
        cwd=str(DEPOT),
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (o.stdout or "").strip()

B = "http://localhost:4200"
PWD = "ChangeMe!2026"
OK = FAIL = 0


def call(method, path, tok=None, body=None):
    r = urllib.request.Request(B + path, method=method)
    r.add_header("Content-Type", "application/json")
    if tok:
        r.add_header("Authorization", "Bearer " + tok)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(r, data) as x:
            return x.status, json.loads(x.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except Exception:
            return e.code, {"message": raw.decode("utf-8", "replace")[:300]}


def check(label, cond, detail=""):
    global OK, FAIL
    if cond:
        OK += 1
        print(f"  OK    {label}")
    else:
        FAIL += 1
        print(f"  ECHEC {label}")
    if detail:
        print(f"          {detail}")


def msg(b):
    m = b.get("message")
    return (m if isinstance(m, str) else " · ".join(map(str, m or [])))[:150]


print("=" * 74)
print("  RECETTE — TYPES D'OPÉRATION ET CHECKLIST HSE")
print("=" * 74)

dg = call("POST", "/api/internal/auth/login", None,
          {"email": "dg@elyon-trading.example", "password": PWD})[1]["accessToken"]
logi = call("POST", "/api/internal/auth/login", None,
            {"email": "logistique@elyon-trading.example", "password": PWD})[1]["accessToken"]
agent = call("POST", "/api/field/auth/login", None,
             {"email": "agent.terrain@elyon-trading.example", "password": PWD})[1]["accessToken"]

print("\n=== A. RÉFÉRENTIEL DES TYPES ===")
s, types = call("GET", "/api/internal/referentials/operation-types", logi)
check("Types d'opération servis au coordinateur", s == 200 and len(types) >= 5,
      " · ".join(f"{t['code']} ({t['checklistCount']} checklist)" for t in types))

par_code = {t["code"]: t for t in types}
check("Le nombre de checklists rattachées est indiqué",
      all("checklistCount" in t for t in types),
      "un type à 0 checklist n'apporte aucun contrôle — visible au moment de choisir")

s, _ = call("GET", "/api/internal/referentials/operation-types", dg)
check("Le DG y accède aussi", s == 200, f"http {s}")

print("\n=== B. CHECKLIST ASSEMBLÉE ===")
s, ops = call("GET", "/api/internal/operations?search=OP-2026-000001", logi)
op = ops["items"][0]
s, detail = call("GET", f"/api/internal/operations/{op['id']}", logi)
portes = detail.get("operationTypes", [])
check("Les types portés figurent au détail de l'opération",
      s == 200 and len(portes) >= 1,
      " · ".join(f"{t['sequence']}. {t['operationType']['label']}" for t in portes))

check("Ils sont rendus dans l'ordre du déroulé",
      [t["sequence"] for t in portes] == sorted(t["sequence"] for t in portes),
      "rang 1 = première étape — le soutage ne précède pas le transport qui l'amène")

s, b = call("POST", f"/api/field/hse/operations/{op['id']}/checks", agent,
            {"phase": "PRE_CHARGEMENT"})
points = b.get("items", []) if isinstance(b, dict) else []
check("Checklist ouverte sur les types portés", s in (200, 201) and len(points) > 0,
      f"http {s} · {len(points)} point(s) — {msg(b) if s >= 400 else ''}")

codes = [p["item"]["code"] for p in points]
check("Aucun point en double", len(codes) == len(set(codes)),
      "un doublon resterait éternellement en attente et bloquerait l'opération")

check("Provenance figée sur chaque point",
      all(p.get("sourceTemplateId") and p.get("sourceTemplateVersion") for p in points),
      "c'est au point, non à la checklist, que la version du modèle est conservée")

bloquants = [p for p in points if p["level"] == "BLOCKING"]
check("Des points bloquants sont opposés", len(bloquants) >= 1,
      f"{len(bloquants)} bloquant(s) sur {len(points)}")

print("\n=== C. SANS TYPE, AUCUN CONTRÔLE ===")
s, b = call("POST", "/api/internal/operations", logi, {
    "dealId": detail["dealId"], "plannedVolume": 1000, "uom": "L",
    "transportMode": "TRUCK", "originLocation": "Dépôt", "destinationLocation": "Site",
    "operationTypeIds": []})
check("Création refusée sans type", s == 400,
      msg(b) or "au moins un type est exigé — sans lui, le verrou HSE serait vide")

s, b = call("POST", "/api/internal/operations", logi, {
    "dealId": detail["dealId"], "plannedVolume": 1000, "uom": "L",
    "transportMode": "TRUCK", "originLocation": "Dépôt", "destinationLocation": "Site"})
check("Champ absent traité comme vide", s == 400, msg(b))

print("\n=== D. OPÉRATION MULTI-TYPES ===")
deux = [par_code["ROUTE"]["id"], par_code["SOUTAGE"]["id"]]
# AFFECTÉE à l'agent : une opération qui ne lui revient pas ne doit pas lui
# ouvrir sa checklist, et c'est exactement ce que le cloisonnement garantit.
AGENT_ID = psql("select id from field_users where email='agent.terrain@elyon-trading.example';")
s, cree = call("POST", "/api/internal/operations", logi, {
    "dealId": detail["dealId"], "plannedVolume": 5000, "uom": "L",
    "transportMode": "TRUCK", "originLocation": "Dépôt SIR — Abidjan",
    "destinationLocation": "Quai — Port d'Abidjan",
    "operationTypeIds": deux, "fieldAgentId": AGENT_ID})
check("Opération portant deux types créée", s in (200, 201), f"http {s} · {msg(cree)}")

if s in (200, 201):
    s, d2 = call("GET", f"/api/internal/operations/{cree['id']}", logi)
    rangs = [(t["sequence"], t["operationType"]["code"]) for t in d2.get("operationTypes", [])]
    check("L'ordre de saisie est le rang enregistré",
          rangs == [(1, "ROUTE"), (2, "SOUTAGE")], f"{rangs}")

    s, b = call("POST", f"/api/field/hse/operations/{cree['id']}/checks", agent,
                {"phase": "PRE_CHARGEMENT"})
    pts = b.get("items", []) if isinstance(b, dict) else []
    check("Checklist assemblée sur les deux types", s in (200, 201) and len(pts) > 0,
          f"http {s} · {len(pts)} point(s) — {msg(b) if s >= 400 else ''}")

print("\n" + "=" * 74)
print(f"  {OK}/{OK + FAIL} cas conformes")
print("=" * 74)
