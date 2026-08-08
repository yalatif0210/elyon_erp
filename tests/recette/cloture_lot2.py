"""
RECETTE DE CLÔTURE — LOT 2

Les briques ajoutées en dernier : registre des factures fournisseurs et
prépaiements (§ 14.6), documents et signatures (§ 12). Le reste du lot a déjà
été recetté ; on revérifie ici qu'il n'a pas régressé.
"""
import json, time, urllib.request, urllib.error
from uuid import uuid4

# Les references doivent etre uniques a chaque passage : les contraintes
# d'unicite du produit sont reelles, et un test rejoue ne doit pas les heurter.
RUN = uuid4().hex[:8].upper()

B = "http://localhost:4200"
PWD = "ChangeMe!2026"
results = []


def call(method, path, token=None, body=None):
    r = urllib.request.Request(B + path, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, json.dumps(body).encode() if body is not None else None) as x:
            return x.status, json.loads(x.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw}


def login(realm, email):
    s, b = call("POST", f"/api/{realm}/auth/login", body={"email": email, "password": PWD})
    assert s == 200, (email, s, b)
    return b["accessToken"]


def check(label, ok, detail=""):
    results.append((ok, label, detail))
    print(("  OK    " if ok else "  ECHEC ") + label + (f"\n          {detail}" if detail else ""))


def msg(b):
    m = b.get("message", b)
    return (m if isinstance(m, str) else json.dumps(m, ensure_ascii=False))[:170]


dg = login("internal", "dg@elyon-trading.example")
cfo = login("internal", "cfo@elyon-trading.example")
logi = login("internal", "logistique@elyon-trading.example")
agent = login("field", "agent.terrain@elyon-trading.example")

deals = {d["reference"]: d for d in call("GET", "/api/internal/deals?pageSize=50", dg)[1]["items"]}
D1 = deals["DEAL-2026-08-001"]["id"]
sup = next(p for p in call("GET", "/api/internal/referentials/partners?pageSize=100", dg)[1]["items"]
           if p["code"] == "SUP-SIR")

print("\n=== A. REGISTRE FOURNISSEURS ET PRÉPAIEMENTS (§ 14.6) ===")

s, b = call("GET", "/api/internal/supplier-invoices?pageSize=50", cfo)
check("Registre lisible", s == 200, f"{s} — {b.get('total')} facture(s)")
rows = b.get("items", [])

attachees = [r for r in rows if r.get("deal")]
check("Factures rattachées au dossier d'affaire", len(attachees) > 0,
      f"{len(attachees)}/{len(rows)} rattachées")

avances = [r for r in rows if float(r["prepaidAmount"]) > 0 and r["settledAt"] is None]
check("Avance non apurée visible — trésorerie immobilisée", len(avances) > 0,
      f"{len(avances)} avance(s) : " + ", ".join(f"{r['reference']} {r['prepaidAmount']}" for r in avances))

# TVA déductible : même formule que la TVA collectée.
s, b = call("POST", "/api/internal/supplier-invoices", cfo, {
    "reference": f"REC-{RUN}-001", "supplierId": sup["id"], "dealId": D1,
    "amount": 1_180_000, "currencyCode": "XOF", "vatRatePct": 18,
    "invoiceDate": "2026-08-14",
})
NEW = b.get("id")
attendu = round(1_180_000 * 18 / 118, 4)
check("TVA déductible EXTRAITE du montant (× 18 ÷ 118)",
      s == 201 and abs(float(b.get("vatAmount", 0)) - attendu) < 0.01,
      f"{s} — TVA {b.get('vatAmount')} sur 1 180 000 (attendu {attendu})")

check("Montant converti au pivot", s == 201 and float(b.get("amountPivot", 0)) > 0,
      f"{b.get('amountPivot')} USD au taux {b.get('fxRateToPivot')}")

s, b = call("PATCH", f"/api/internal/supplier-invoices/{NEW}/settle", cfo,
            {"settledAt": "2026-08-15", "reason": "Regularisation comptable de test"})
check("Apurement refusé quand rien n'a été réglé d'avance", s == 400, f"{s} — {msg(b)}")

s, b = call("POST", f"/api/internal/supplier-invoices/{NEW}/payments", cfo,
            {"amount": 1_180_000, "paidAt": "2026-08-14", "bankReference": "VIR-88213"})
check("Règlement enregistré et qualifié d'avance", s == 201, f"{s} — {b.get('amount')}")

s, b = call("GET", f"/api/internal/supplier-invoices/{NEW}", cfo)
check("Avance portée au BFR tant qu'elle n'est pas apurée",
      float(b.get("prepaidAmount", 0)) > 0 and b.get("settledAt") is None,
      f"avance {b.get('prepaidAmount')} · apurée : {b.get('settledAt')}")
check("Facture passée à RÉGLÉE", b.get("status") == "PAID", str(b.get("status")))

s, b = call("POST", f"/api/internal/supplier-invoices/{NEW}/payments", cfo,
            {"amount": 500_000, "paidAt": "2026-08-16"})
check("Règlement au-delà du solde refusé", s == 400, f"{s} — {msg(b)}")

s, b = call("PATCH", f"/api/internal/supplier-invoices/{NEW}/settle", cfo,
            {"settledAt": "2026-08-15", "reason": "Facture rattachee a aucune operation — regularisation"})
check("Apurement manuel accepté avec motif", s == 200, f"{s} — apurée le {str(b.get('settledAt'))[:10]}")

s, b = call("POST", "/api/internal/supplier-invoices", logi, {
    "reference": f"REC-{RUN}-002", "supplierId": sup["id"],
    "amount": 100, "currencyCode": "ZZZ", "invoiceDate": "2026-08-14",
})
check("Devise sans taux de change refusée", s in (400, 422), f"{s} — {msg(b)}")

s, b = call("PATCH", f"/api/internal/supplier-invoices/{NEW}/settle", cfo, {"settledAt": "2026-08-15"})
check("Apurement manuel refusé sans motif", s == 400, f"{s} — {msg(b)[:90]}")

print("\n=== B. DOCUMENTS ET SIGNATURES (§ 12) ===")

s, b = call("GET", "/api/internal/documents?pageSize=20", dg)
check("Registre documentaire lisible", s == 200, f"{s} — {b.get('total')} pièce(s)")

# La pièce est cherchée PAR NATURE, non à la première page : chaque campagne
# ajoute des rapports d'exécution, et le bon de livraison finissait par sortir
# de la page 1. L'échec ne disait alors rien du code, seulement du volume.
s, bls = call("GET", "/api/internal/documents?kind=DELIVERY_NOTE&pageSize=20", dg)
bl = next((d for d in bls.get("items", [])), None)
check("Bon de livraison signé et scellé",
      bl is not None and bl["isSealed"] and bl["_count"]["signatures"] >= 2,
      f"{bl['reference'] if bl else '—'} · {bl['_count']['signatures'] if bl else 0} signature(s)")

if bl:
    s, b = call("GET", f"/api/internal/documents/{bl['id']}", dg)
    sigs = b.get("signatures", [])
    qualites = [x["signatoryCapacity"][:40] for x in sigs]
    check("Qualité du signataire portée sur chaque signature",
          all(x["signatoryCapacity"] for x in sigs), " · ".join(qualites))
    check("Double horodatage conservé — appareil et serveur",
          any(x["deviceTimestamp"] and x["serverTimestamp"] for x in sigs),
          "l'écart entre les deux est un signal d'audit")

    s, b = call("POST", f"/api/field/documents/{bl['id']}/signatures", agent, {
        "kind": "CLIENT_REPRESENTATIVE", "signatoryName": "Test Après Scellement",
        "signatoryCapacity": "Tentative",
    })
    check("Signature refusée sur une pièce scellée", s == 400, f"{s} — {msg(b)}")

    s, b = call("PATCH", f"/api/internal/documents/{bl['id']}/seal", dg)
    check("Second scellement refusé", s == 400, f"{s} — {msg(b)}")

# Une pièce non rattachée est introuvable le jour où on la cherche.
s, b = call("POST", "/api/internal/documents", logi, {
    "kind": "TRANSPORT_ORDER", "storageKey": f"documents/test/{RUN}-orphelin.pdf",
    "sizeBytes": 1024, "sha256": ("f" + RUN.lower() * 8)[:64],
})
check("Pièce sans rattachement refusée", s == 400, f"{s} — {msg(b)}")

s, b = call("POST", "/api/internal/documents", logi, {
    "kind": "OPERATION_REPORT", "dealId": D1,
    "storageKey": f"documents/test/{RUN}-rapport.pdf",
    "sizeBytes": 240_128, "sha256": (RUN.lower() * 8)[:64],
})
check("Rapport d'exécution enregistré", s == 201, f"{s} — {b.get('reference')}")
RAP = b.get("id")

s, b = call("PATCH", f"/api/internal/documents/{RAP}/seal", dg)
check("Scellement refusé sur un rapport non signé", s == 400, f"{s} — {msg(b)}")

s, b = call("POST", f"/api/internal/documents/{RAP}/signatures", logi, {
    "kind": "INTERNAL_USER", "signatoryName": "Coordinateur Logistique",
    "signatoryCapacity": "Responsable de l'exécution",
})
check("Signature apposée", s == 201, f"{s}")

s, b = call("PATCH", f"/api/internal/documents/{RAP}/seal", dg)
check("Scellement accepté une fois signé", s == 200, f"{s} — scellé le {str(b.get('sealedAt'))[:19]}")

s, b = call("POST", f"/api/internal/documents/{RAP}/supersede", dg, {
    "kind": "OPERATION_REPORT", "dealId": D1,
    "storageKey": f"documents/test/{RUN}-rapport-v2.pdf",
    "sizeBytes": 241_000, "sha256": ("c" + RUN.lower() * 8)[:64],
    "reason": "Volume livre corrige apres releve contradictoire du 12 aout",
})
check("« Annule et remplace » sur une pièce scellée", s == 201,
      f"{s} — {b.get('reference')} remplace la précédente")
V2 = b.get("id")

s, b = call("POST", f"/api/internal/documents/{RAP}/supersede", dg, {
    "kind": "OPERATION_REPORT", "dealId": D1, "storageKey": f"documents/test/{RUN}-v3.pdf",
    "sizeBytes": 1000, "sha256": ("d" + RUN.lower() * 8)[:64], "reason": "Second remplacement interdit",
})
check("Double remplacement refusé", s == 400, f"{s} — {msg(b)}")

s, b = call("POST", f"/api/internal/documents/{RAP}/supersede", dg, {
    "kind": "OPERATION_REPORT", "dealId": D1, "storageKey": f"documents/test/{RUN}-v4.pdf",
    "sizeBytes": 1000, "sha256": ("e" + RUN.lower() * 8)[:64], "reason": "court",
})
check("Remplacement sans motif circonstancié refusé", s == 400, f"{s} — {msg(b)}")

if bl:
    s, b = call("GET", f"/api/internal/documents/verify/{bl['authenticityToken']}", dg)
    check("Vérification d'authenticité par jeton", s == 200 and b.get("valid") is True,
          f"{b.get('reference')} · {b.get('message')}")
    s, b = call("GET", "/api/internal/documents/verify/jeton-inexistant", dg)
    check("Jeton inconnu déclaré non valide", b.get("valid") is False, msg(b))

print("\n=== C. NON-RÉGRESSION DU LOT 2 DÉJÀ RECETTÉ ===")

for label, route, tok in [
    ("Chaîne de marge et verdict des seuils", f"/api/internal/deals/{D1}", dg),
    ("Opérations et verrou HSE", "/api/internal/operations?pageSize=1", logi),
    ("Facturation", "/api/internal/invoices?pageSize=1", cfo),
    ("Surveillance de la bande de marge", "/api/internal/supervision/margin-band", dg),
    ("Rapprochement des coûts", "/api/internal/supervision/cost-reconciliation", cfo),
    ("En-cours crédit", "/api/internal/supervision/credit-exposure", cfo),
    ("Avances fournisseurs en cours", "/api/internal/supervision/outstanding-prepayments", cfo),
]:
    s, b = call("GET", route, tok)
    check(label, s == 200, f"http {s}")

s, b = call("GET", f"/api/internal/deals/{D1}", dg)
m, t = b["margin"], b["thresholds"]
check("Marge inchangée après ajout des nouvelles briques",
      abs(m["directMargin"] - 55.28) < 0.01 and abs(m["fullMargin"] - 38.28) < 0.01,
      f"directe {m['directMargin']} · complète {m['fullMargin']} · {t['message']}")

ok = sum(1 for r in results if r[0])
print(f"\n{'=' * 74}\n  {ok}/{len(results)} cas conformes\n{'=' * 74}")
for r in results:
    if not r[0]:
        print(f"  ECHEC : {r[1]}\n          {r[2]}")
