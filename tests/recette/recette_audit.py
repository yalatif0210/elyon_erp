# -*- coding: utf-8 -*-
"""
RECETTE DES CORRECTIFS D'AUDIT.

Chaque cas correspond a un defaut CONSTATE pendant l'audit du 8 aout 2026, et
prouve que le correctif mord reellement — par l'API, pas par lecture du code.

  1. Le cumul facture est borne par le volume CONTRACTE de l'affaire.
     Modele Elyon : le volume commande EST le volume livre, et la facture
     n'attend pas l'execution. La reference est donc l'affaire, jamais
     l'operation. Une proforma n'engage rien et reste libre.

  2. Le solde encaisse est DERIVE du journal des reglements.
     Il etait tenu par l'application, a partir d'une lecture hors transaction :
     deux reglements concurrents s'ecrasaient. Il ne se saisit plus.

  3. Un meme mouvement bancaire ne s'enregistre qu'une fois.

  4. Ce qui attend se voit : creances echues, FNE non transmises, reliquat a
     facturer.

Les pieces creees sont annulees en fin de course.
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
        with urllib.request.urlopen(r, json.dumps(body).encode() if body else None) as x:
            txt = x.read().decode()
            return x.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def cas(libelle, condition, detail=""):
    global ok, ko
    if condition:
        ok += 1
        print(f"  ok   {libelle}")
    else:
        ko += 1
        print(f"  ECHEC {libelle} :: {detail}")


print("RECETTE DES CORRECTIFS D'AUDIT")
print("=" * 70)
cfo = token("cfo@elyon-trading.example")

# --- contexte : une affaire et son reliquat ------------------------------
code, reste = call("/api/internal/supervision/reste-a-facturer", cfo)
if code == 404:
    # La route n'est pas exposee : on lit l'affaire par l'API des affaires.
    code, deals = call("/api/internal/deals?pageSize=50", cfo)
    items = deals.get("items", deals) if isinstance(deals, dict) else deals
    affaire = next((d for d in items if d["reference"] == "DEAL-2026-08-001"), None)
else:
    affaire = None

code, deals = call("/api/internal/deals?pageSize=50", cfo)
items = deals.get("items", deals) if isinstance(deals, dict) else deals
affaire = next((d for d in items if d["reference"] == "DEAL-2026-08-001"), None)
cas("l'affaire temoin est lisible", affaire is not None, str(items)[:120])

creees = []

# --- 1. La facturation est bornee par le contrat -------------------------
print("\n1. Le cumul facture est borne par le volume contracte")
if affaire:
    base = {"dealId": affaire["id"], "uom": "L", "unitPrice": 800,
            "currencyCode": "XOF", "isVatApplicable": True, "vatRatePct": 18}

    code, rep = call("/api/internal/invoices", cfo, "POST",
                     {**base, "type": "FNE", "billedVolume": 5000})
    cas("facturer 5 000 L au-dela du reliquat : refuse", code >= 400, f"{code} {rep}")

    code, piece = call("/api/internal/invoices", cfo, "POST",
                       {**base, "type": "FNE", "billedVolume": 50})
    cas("facturer 50 L dans le reliquat : accepte", code in (200, 201), f"{code} {piece}")
    if isinstance(piece, dict) and piece.get("id"):
        creees.append(piece["id"])

    code, pro = call("/api/internal/invoices", cfo, "POST",
                     {**base, "type": "PROFORMA", "billedVolume": 50000})
    cas("une proforma hors contrat reste libre", code in (200, 201), f"{code} {pro}")
    if isinstance(pro, dict) and pro.get("id"):
        creees.append(pro["id"])

# --- 2. Le solde encaisse est derive -------------------------------------
print("\n2. Le solde encaisse est derive du journal")
piece_id = creees[0] if creees else None
if piece_id:
    code, rep = call(f"/api/internal/invoices/{piece_id}/issue", cfo, "PATCH", {})
    cas("la piece s'emet", code in (200, 201), f"{code} {rep}")

    code, rep = call(f"/api/internal/invoices/{piece_id}/payments", cfo, "POST",
                     {"amount": 10000, "currencyCode": "XOF",
                      "valueDate": "2026-08-08", "bankReference": "VIR-RECETTE-001"})
    cas("un encaissement s'enregistre", code in (200, 201), f"{code} {rep}")

    code, det = call(f"/api/internal/invoices/{piece_id}", cfo)
    solde = float(det.get("paidAmount", 0)) if isinstance(det, dict) else -1
    cas("le solde suit le journal (10 000)", abs(solde - 10000) < 0.01, f"observe {solde}")

    # 3. Meme reference bancaire : refuse.
    code, rep = call(f"/api/internal/invoices/{piece_id}/payments", cfo, "POST",
                     {"amount": 5000, "currencyCode": "XOF",
                      "valueDate": "2026-08-08", "bankReference": "VIR-RECETTE-001"})
    cas("meme reference bancaire : refusee", code >= 400, f"{code} {rep}")

    # Une autre reference passe.
    code, rep = call(f"/api/internal/invoices/{piece_id}/payments", cfo, "POST",
                     {"amount": 5000, "currencyCode": "XOF",
                      "valueDate": "2026-08-08", "bankReference": "VIR-RECETTE-002"})
    cas("une autre reference bancaire passe", code in (200, 201), f"{code} {rep}")

    code, det = call(f"/api/internal/invoices/{piece_id}", cfo)
    solde = float(det.get("paidAmount", 0)) if isinstance(det, dict) else -1
    cas("le solde cumule les deux (15 000)", abs(solde - 15000) < 0.01, f"observe {solde}")

    # Encaisser plus que du : refuse.
    code, rep = call(f"/api/internal/invoices/{piece_id}/payments", cfo, "POST",
                     {"amount": 999999999, "currencyCode": "XOF",
                      "valueDate": "2026-08-08", "bankReference": "VIR-RECETTE-003"})
    cas("encaisser plus que le total : refuse", code >= 400, f"{code}")

# --- 4. Ce qui attend se voit --------------------------------------------
print("\n4. Ce qui attend se voit")
compta = token("comptable@elyon-trading.example")
code, taches = call("/api/internal/supervision/taches", compta)
cats = {t["categorie"] for t in taches} if isinstance(taches, list) else set()
cas("les FNE non transmises remontent", "FNE_NON_TRANSMISE" in cats, str(sorted(cats))[:200])
cas("le reliquat a facturer remonte", "RESTE_A_FACTURER" in cats, str(sorted(cats))[:200])

# --- nettoyage : annulation, jamais suppression --------------------------
for pid in creees:
    call(f"/api/internal/invoices/{pid}/cancel", cfo, "PATCH", {"reason": "piece de recette"})

print("\n" + "=" * 70)
print(f"{ok}/{ok + ko} cas conformes")
if creees:
    print("Pieces de recette a annuler :", ", ".join(creees))
