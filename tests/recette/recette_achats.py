# -*- coding: utf-8 -*-
"""
RECETTE DES ACHATS (ticket #5 - emission de la Commande d'achat).

Ce que ces cas prouvent :
  - une Operation BACK_TO_BACK, une fois ses moyens affectes, porte une
    Commande d'achat emise automatiquement, reprenant le fournisseur et le
    prix deja valides sur l'Affaire (Deal.supplierPriceId) - jamais ressaisis ;
  - reaffecter les MEMES moyens sur une operation deja pourvue ne re-emet
    jamais une seconde commande (contrainte 1-to-1 en base, et l'appel doit
    rester rejouable comme le reste de l'affectation des moyens) ;
  - le registre des commandes d'achat est lisible par les roles achats /
    logistique / direction, refuse au commercial.
"""
import json, urllib.request, urllib.error

B = "http://localhost:4200"
PWD = "ChangeMe!2026"
ok, ko = 0, 0


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
        with urllib.request.urlopen(r, json.dumps(body).encode() if body is not None else None) as x:
            txt = x.read().decode()
            return x.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:300]}


def cas(libelle, condition, detail=""):
    global ok, ko
    if condition:
        ok += 1
        print(f"  ok   {libelle}")
    else:
        ko += 1
        print(f"  ECHEC {libelle} :: {detail}")


print("RECETTE DES ACHATS")
print("=" * 68)
dg = token("dg@elyon-trading.example")
logi = token("logistique@elyon-trading.example")
commercial = token("commercial@elyon-trading.example")

# --- contexte : l'affaire et l'operation deja seedees -----------------------
_, deals = call("/api/internal/deals?pageSize=50", dg)
deal1 = next(d for d in deals["items"] if d["reference"] == "DEAL-2026-08-001")

_, types = call("/api/internal/referentials/operation-types", dg)
route = next(t for t in types if t["code"] == "ROUTE")

_, ops = call(f"/api/internal/operations?dealId={deal1['id']}&pageSize=5", dg)
op1 = next(o for o in ops["items"] if o["reference"] == "OP-2026-000001")
_, op1_detail = call(f"/api/internal/operations/{op1['id']}", dg)
ligne = op1_detail["assignments"][0]
VEHICLE, DRIVER = ligne["vehicleId"], ligne["driverId"]

print("\n1. Une operation deja pourvue n'est jamais re-emise")

_, avant = call("/api/internal/purchase-orders?search=PO-2026-08-001", dg)
cas("la commande seedee existe deja, une seule fois", avant["total"] == 1, f"{avant}")
po_avant_id = avant["items"][0]["id"]

code, b = call(f"/api/internal/operations/{op1['id']}/assignment", logi, "PATCH",
               {"assignments": [{"vehicleId": VEHICLE, "driverId": DRIVER}]})
cas("reaffectation des memes moyens acceptee", code == 200, f"{code} {b}")

_, apres = call("/api/internal/purchase-orders?search=PO-2026-08-001", dg)
cas("toujours une seule commande sur cette operation, jamais dupliquee",
    apres["total"] == 1 and apres["items"][0]["id"] == po_avant_id, f"{apres}")

print("\n2. Emission automatique sur une nouvelle operation BACK_TO_BACK")

code, nouvelle = call("/api/internal/operations", logi, "POST", {
    "dealId": deal1["id"],
    "plannedVolume": 5000,
    "uom": "L",
    "transportMode": "TRUCK",
    "sourcingMode": "BACK_TO_BACK",
    "operationTypeIds": [route["id"]],
    "originLocation": "Depot SIR, Abidjan",
    "destinationLocation": "Site minier, Man",
})
cas("nouvelle operation BACK_TO_BACK creee", code == 201, f"{code} {nouvelle}")
OPN = nouvelle.get("id") if isinstance(nouvelle, dict) else None

if OPN:
    _, avant2 = call(f"/api/internal/operations/{OPN}", dg)
    cas("aucune commande avant toute affectation de moyens",
        avant2.get("purchaseOrder") is None, str(avant2.get("purchaseOrder")))

    code, b = call(f"/api/internal/operations/{OPN}/assignment", logi, "PATCH",
                   {"assignments": [{"vehicleId": VEHICLE, "driverId": DRIVER}]})
    cas("affectation des moyens acceptee", code == 200, f"{code} {b}")

    _, op_apres = call(f"/api/internal/operations/{OPN}", dg)
    po = op_apres.get("purchaseOrder")
    cas("la commande est emise a l'affectation des moyens", po is not None, str(po))

    if po:
        cas("statut EMISE", po["status"] == "ISSUED", po["status"])
        cas("volume repris de l'operation", abs(float(po["orderedVolume"]) - 5000) < 0.001,
            po["orderedVolume"])
        cas("prix unitaire repris de l'affaire, jamais ressaisi",
            abs(float(po["unitPrice"]) - float(deal1["unitPurchasePrice"])) < 0.001,
            f"{po['unitPrice']} vs affaire {deal1['unitPurchasePrice']}")
        cas("montant total = volume x prix unitaire",
            abs(float(po["totalAmount"]) - 5000 * float(deal1["unitPurchasePrice"])) < 0.01,
            po["totalAmount"])
        cas("devise reprise de l'affaire", po["currencyCode"] == deal1["currencyCode"],
            po["currencyCode"])
        cas("prix fournisseur trace (traçabilite du cout d'achat)",
            po["supplierPriceId"] == deal1["supplierPriceId"], po["supplierPriceId"])

    # Reaffectation immediate : toujours la MEME commande, jamais une seconde.
    code, b = call(f"/api/internal/operations/{OPN}/assignment", logi, "PATCH",
                   {"assignments": [{"vehicleId": VEHICLE, "driverId": DRIVER}]})
    _, op_reaffecte = call(f"/api/internal/operations/{OPN}", dg)
    po2 = op_reaffecte.get("purchaseOrder")
    cas("reaffectation ulterieure : toujours la meme commande",
        code == 200 and po2 is not None and po2["id"] == po["id"], f"{code} {po2}")

print("\n3. Retirer les moyens n'engage aucun achat")

code, vide = call("/api/internal/operations", logi, "POST", {
    "dealId": deal1["id"],
    "plannedVolume": 2000,
    "uom": "L",
    "transportMode": "TRUCK",
    "sourcingMode": "BACK_TO_BACK",
    "operationTypeIds": [route["id"]],
    "originLocation": "Depot SIR, Abidjan",
    "destinationLocation": "Site minier, Man",
})
cas("operation BACK_TO_BACK creee pour ce cas", code == 201, f"{code} {vide}")
OPV = vide.get("id") if isinstance(vide, dict) else None

if OPV:
    code, b = call(f"/api/internal/operations/{OPV}/assignment", logi, "PATCH", {"assignments": []})
    cas("affectation vide acceptee (retrait des moyens)", code == 200, f"{code} {b}")

    _, op_vide = call(f"/api/internal/operations/{OPV}", dg)
    cas("aucune commande emise sans aucun moyen affecte",
        op_vide.get("purchaseOrder") is None, str(op_vide.get("purchaseOrder")))

print("\n4. Registre des commandes d'achat")

code, reg = call("/api/internal/purchase-orders?pageSize=50", logi)
cas("le registre est lisible par la logistique", code == 200, f"{code}")
refs = {c["reference"] for c in reg.get("items", [])}
cas("la commande seedee y figure", "PO-2026-08-001" in refs, str(refs))
if OPN and po:
    cas("la nouvelle commande y figure aussi", po["reference"] in refs, str(refs))

item = next((c for c in reg.get("items", []) if c["reference"] == "PO-2026-08-001"), None)
cas("chaque commande porte l'operation et l'affaire d'origine",
    item is not None and item["operation"]["reference"] == "OP-2026-000001"
    and item["operation"]["deal"]["reference"] == "DEAL-2026-08-001",
    str(item))

code, b = call("/api/internal/purchase-orders", commercial)
cas("le registre est refuse au commercial", code == 403, f"{code} {b}")

code, b = call("/api/internal/purchase-orders?status=ISSUED", dg)
cas("le filtre par statut fonctionne", code == 200 and all(c["status"] == "ISSUED" for c in b["items"]),
    f"{code} {b.get('total')}")

print("\n" + "=" * 68)
print(f"{ok}/{ok + ko} cas conformes")
