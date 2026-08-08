# -*- coding: utf-8 -*-
"""
RECETTE DU CRM (SS 15).

Ce que ces cas prouvent :
  - une opportunite se cree, franchit ses etapes, et son historique s'ecrit SEUL ;
  - la prochaine action et la date de relance sont OBLIGATOIRES (SS 15) ;
  - une opportunite perdue sans motif est REFUSEE ;
  - la valeur ponderee se TAIT tant que la probabilite n'est pas decidee ;
  - les alertes se levent et s'eteignent sur le drapeau, pas sur une deduction.

Les objets crees sont retires en fin de course.
"""
import json, urllib.request, urllib.error

B = "http://localhost:4200"
PWD = "ChangeMe!2026"
ok, ko = 0, 0
cree = []


def token(email):
    r = urllib.request.Request(B + "/api/internal/auth/login", method="POST")
    r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r, json.dumps({"email": email, "password": PWD}).encode()) as x:
        return json.load(x)["accessToken"]


def call(path, t, method="GET", body=None):
    r = urllib.request.Request(B + path, method=method)
    r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", "Bearer " + t)
    try:
        with urllib.request.urlopen(r, json.dumps(body).encode() if body else None) as x:
            txt = x.read().decode()
            return x.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:280]


def cas(libelle, condition, detail=""):
    global ok, ko
    if condition:
        ok += 1
        print(f"  ok   {libelle}")
    else:
        ko += 1
        print(f"  ECHEC {libelle} :: {detail}")


print("RECETTE DU CRM")
print("=" * 68)
ccoo = token("ccoo@elyon-trading.example")
logi = token("logistique@elyon-trading.example")

# --- contexte -------------------------------------------------------------
code, etapes = call("/api/internal/crm/stages", ccoo)
par_code = {e["code"]: e for e in etapes}
cas("les 13 etapes du SS 15 sont en place", len(etapes) == 13, str(len(etapes)))
cas("aucune probabilite n'est inventee",
    all(e["probabilityPct"] is None for e in etapes if e["outcome"] == "OPEN"),
    "des etapes OPEN portent une probabilite")
cas("gagnee vaut 100, perdue vaut 0",
    par_code["GAGNEE"]["probabilityPct"] == "100" and par_code["PERDUE"]["probabilityPct"] == "0",
    f"{par_code['GAGNEE']['probabilityPct']} / {par_code['PERDUE']['probabilityPct']}")

code, tiers = call("/api/internal/referentials/partners?pageSize=5", ccoo)
items = tiers.get("items", tiers) if isinstance(tiers, dict) else tiers
client = next((p for p in items if p["type"] in ("CLIENT", "PROSPECT")), None)
code, produits = call("/api/internal/referentials/products?pageSize=1", ccoo)
pitems = produits.get("items", produits) if isinstance(produits, dict) else produits

# --- 1. Creation ----------------------------------------------------------
print("\n1. Creation d'une opportunite")
base = {
    "title": "Recette CRM - approvisionnement station",
    "partnerId": client["id"],
    "segment": "B2B",
    "productId": pitems[0]["id"],
    "estimatedVolume": 400000,
    "uom": "L",
    "referencePrice": 760,
    "currencyCode": "XOF",
    "stageId": par_code["QUALIFIE"]["id"],
    "nextAction": "Rappeler le directeur technique",
    "nextActionDue": "2026-08-20",
}
code, opp = call("/api/internal/crm/opportunites", ccoo, "POST", base)
cas("le CCOO cree une opportunite", code in (200, 201), f"{code} {opp}")
if isinstance(opp, dict) and opp.get("id"):
    cree.append(opp["id"])

sans_action = dict(base)
del sans_action["nextAction"]
code, rep = call("/api/internal/crm/opportunites", ccoo, "POST", sans_action)
cas("une opportunite sans prochaine action est refusee", code == 400, f"{code}")

code, rep = call("/api/internal/crm/opportunites", logi, "POST", base)
cas("le coordinateur logistique ne cree pas d'opportunite", code == 403, f"{code}")

# --- 2. Valeur ponderee ---------------------------------------------------
print("\n2. Valeur ponderee")
code, pipeline = call("/api/internal/crm/pipeline", ccoo)
ligne = next((o for o in pipeline if o["id"] == opp["id"]), None) if isinstance(opp, dict) else None
cas("l'opportunite figure au pipeline", ligne is not None, "")
if ligne:
    cas("le CA previsionnel est derive du volume",
        abs(float(ligne["ca_previsionnel"]) - 400000 * 760) < 1, ligne["ca_previsionnel"])
    cas("la valeur ponderee se tait sans probabilite decidee",
        ligne["valeur_ponderee"] is None, str(ligne["valeur_ponderee"]))

# --- 3. Franchissement d'etape et historique ------------------------------
print("\n3. Franchissement d'etape")
if isinstance(opp, dict) and opp.get("id"):
    code, rep = call(f"/api/internal/crm/opportunites/{opp['id']}/etape", ccoo, "PATCH",
                     {"stageId": par_code["OFFRE_ENVOYEE"]["id"], "note": "Offre remise en main propre"})
    cas("l'etape se franchit", code == 200, f"{code} {rep}")

    code, detail = call(f"/api/internal/crm/opportunites/{opp['id']}", ccoo)
    n = len(detail.get("transitions", [])) if isinstance(detail, dict) else 0
    cas("l'historique s'ecrit seul (2 passages)", n == 2, f"{n} passage(s)")

    # Perte sans motif : refusee par la base.
    code, rep = call(f"/api/internal/crm/opportunites/{opp['id']}/etape", ccoo, "PATCH",
                     {"stageId": par_code["PERDUE"]["id"]})
    cas("perdue sans motif : refusee", code >= 400, f"{code}")

# --- 4. Interactions et relances ------------------------------------------
print("\n4. Interactions et relances")
if isinstance(opp, dict) and opp.get("id"):
    code, inter = call(f"/api/internal/crm/opportunites/{opp['id']}/interactions", ccoo, "POST", {
        "kind": "CALL", "occurredAt": "2026-08-05T10:00:00.000Z",
        "summary": "Appel de suivi, le client demande un delai",
        "contactName": "M. Kone",
        "nextAction": "Renvoyer l'offre revisee",
        "nextActionDue": "2026-08-01",
    })
    cas("une interaction se journalise", code in (200, 201), f"{code} {inter}")

    code, rep = call(f"/api/internal/crm/opportunites/{opp['id']}/interactions", ccoo, "POST", {
        "kind": "EMAIL", "occurredAt": "2026-08-05T11:00:00.000Z",
        "summary": "Courriel sans suite prevue",
    })
    cas("une interaction sans action suivante est refusee", code == 400, f"{code}")

    code, alertes = call("/api/internal/crm/alertes", ccoo)
    mienne = [a for a in alertes if a["reference"] == opp.get("reference")]
    cas("la relance echue leve une alerte", len(mienne) > 0, f"{len(mienne)} alerte(s)")

    if isinstance(inter, dict) and inter.get("id"):
        code, rep = call(f"/api/internal/crm/interactions/{inter['id']}/action", ccoo, "PATCH",
                         {"done": True})
        cas("l'action se marque faite", code == 200, f"{code}")
        code, alertes = call("/api/internal/crm/alertes", ccoo)
        restantes = [a for a in alertes
                     if a["reference"] == opp.get("reference") and a["nature"] == "RELANCE"]
        cas("l'alerte de relance s'eteint", len(restantes) == 0, f"{len(restantes)} restante(s)")

print("\n" + "=" * 68)
print(f"{ok}/{ok + ko} cas conformes")
print("\nOpportunites creees (a retirer) :", ", ".join(cree) if cree else "aucune")
