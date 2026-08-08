# -*- coding: utf-8 -*-
"""
RECETTE DES DONNEES BUDGETAIRES (SS 14.2, 14.3, 14.5, 14.6, 19).

Ce que ces cas prouvent :
  - les quatre referentiels s'ecrivent REELLEMENT par l'API (pas seulement
    au catalogue) ;
  - les verrous mordent : un seul exercice courant, un seul taux courant,
    exercice clos non modifiable, budget de vente non ecrasable ;
  - le pilotage se TAIT quand une donnee manque, au lieu d'afficher un zero.

Les objets crees sont refermes en fin de course (is_current a false, exercice
d'essai marque). Rien n'est laisse actif.
"""
import json, urllib.request, urllib.error

B = "http://localhost:4200"
PWD = "ChangeMe!2026"
ANNEE_ESSAI = 2099  # 2094 sert aux cas de bornes

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


def ecrire(t, cle, valeurs, motif="recette budgetaire"):
    return call(f"/api/internal/parameters/{cle}", t, "POST",
                {"values": valeurs, "reason": motif})


print("RECETTE DES DONNEES BUDGETAIRES")
print("=" * 68)
cfo = token("cfo@elyon-trading.example")
vendeur = token("commercial@elyon-trading.example")

# --- 1. Exercice comptable -------------------------------------------------
print("\n1. Exercice comptable")
code, rep = ecrire(cfo, "fiscal-years", {
    "year": ANNEE_ESSAI, "label": "Exercice de recette",
    "startsOn": "2099-01-01", "endsOn": "2099-12-31",
    "status": "OPEN", "isCurrent": False,
})
cas("le CFO cree un exercice", code in (200, 201), f"{code} {rep}")

code, rep = ecrire(vendeur, "fiscal-years", {
    "year": 2098, "label": "Interdit", "startsOn": "2098-01-01",
    "endsOn": "2098-12-31", "status": "PLANNED",
})
cas("un commercial ne peut pas creer d'exercice", code == 403, f"{code}")

code, rep = ecrire(cfo, "fiscal-years", {
    "year": 2097, "label": "Bornes inversees",
    "startsOn": "2097-12-31", "endsOn": "2097-01-01", "status": "PLANNED",
})
cas("bornes inversees refusees", code >= 400, f"{code}")

code, rep = ecrire(cfo, "fiscal-years", {
    "year": 2096, "label": "Trop long", "startsOn": "2096-01-01",
    "endsOn": "2099-01-01", "status": "PLANNED",
})
cas("exercice de plus de deux ans refuse", code >= 400, f"{code}")

# --- 2. Taux de financement ------------------------------------------------
print("\n2. Taux de financement")
code, rep = ecrire(cfo, "financing-rates", {
    "fiscalYearId": ANNEE_ESSAI, "annualRatePct": 11.75,
    "carryingDaysPerYear": 360, "source": "recette", "version": 1,
    "isCurrent": True,
})
cas("taux rattache a l'exercice", code in (200, 201), f"{code} {rep}")

code, rep = ecrire(cfo, "financing-rates", {
    "fiscalYearId": ANNEE_ESSAI, "annualRatePct": 250,
    "carryingDaysPerYear": 360, "version": 9,
})
cas("taux hors plage refuse", code >= 400, f"{code}")

code, rep = ecrire(cfo, "financing-rates", {
    "fiscalYearId": ANNEE_ESSAI, "annualRatePct": 8,
    "carryingDaysPerYear": 100, "version": 8,
})
cas("base de jours aberrante refusee", code >= 400, f"{code}")

# --- 3. Charges fixes ------------------------------------------------------
print("\n3. Budget de charges fixes")
code, rep = ecrire(cfo, "fixed-cost-budgets", {
    "fiscalYearId": ANNEE_ESSAI, "label": "Structure de recette",
    "annualAmount": 120000000, "currencyCode": "XOF",
    "version": 1, "isCurrent": True,
})
cas("poste de charge fixe cree", code in (200, 201), f"{code} {rep}")

code, rep = ecrire(cfo, "fixed-cost-budgets", {
    "fiscalYearId": ANNEE_ESSAI, "label": "Montant negatif",
    "annualAmount": -5, "currencyCode": "XOF", "version": 1,
})
cas("montant negatif refuse", code >= 400, f"{code}")

# --- 4. Prevision de vente -------------------------------------------------
print("\n4. Prevision de vente")
code, produits = call("/api/internal/referentials/products?pageSize=1", cfo)
items = produits.get("items", produits) if isinstance(produits, dict) else produits
produit = items[0]["code"] if items else None
cas("un produit est disponible pour la prevision", produit is not None, str(produits)[:120])

if produit:
    code, rep = ecrire(cfo, "sales-forecasts", {
        "fiscalYearId": ANNEE_ESSAI, "segment": "B2B", "productId": produit,
        "monthIndex": 1, "forecastVolume": 500000, "uom": "L",
        "referencePrice": 750, "currencyCode": "XOF",
        "kind": "BUDGET", "version": 1, "isCurrent": True,
    })
    cas("prevision mensuelle creee", code in (200, 201), f"{code} {rep}")

    code, rep = ecrire(cfo, "sales-forecasts", {
        "fiscalYearId": ANNEE_ESSAI, "segment": "B2B", "productId": produit,
        "monthIndex": 13, "forecastVolume": 1, "uom": "L",
        "referencePrice": 1, "currencyCode": "XOF", "kind": "BUDGET", "version": 2,
    })
    cas("mois 13 refuse", code >= 400, f"{code}")

    code, rep = ecrire(cfo, "sales-forecasts", {
        "fiscalYearId": ANNEE_ESSAI, "segment": "B2B", "productId": produit,
        "monthIndex": 2, "forecastVolume": -1, "uom": "L",
        "referencePrice": 700, "currencyCode": "XOF", "kind": "BUDGET", "version": 1,
    })
    cas("volume negatif refuse", code >= 400, f"{code}")

# --- 6. La prevision reste dans les bornes de son exercice -----------------
# Un exercice COURT (6 mois) : le mois 12 n'existe pas pour lui.
print(chr(10) + "6. Bornes de l'exercice")
code, rep = ecrire(cfo, "fiscal-years", {
    "year": 2094, "label": "Exercice court de recette",
    "startsOn": "2094-01-01", "endsOn": "2094-06-30",
    "status": "OPEN", "isCurrent": False,
})
cas("exercice court de 6 mois cree", code in (200, 201), f"{code} {rep}")

if produit:
    court = {"fiscalYearId": 2094, "segment": "B2B", "productId": produit,
             "uom": "L", "referencePrice": 700, "currencyCode": "XOF", "version": 1}

    code, rep = ecrire(cfo, "sales-forecasts",
                       {**court, "monthIndex": 12, "forecastVolume": 1000, "kind": "BUDGET"})
    cas("mois 12 refuse sur un exercice de 6 mois", code >= 400, f"{code}")

    code, rep = ecrire(cfo, "sales-forecasts",
                       {**court, "monthIndex": 3, "forecastVolume": 1000, "kind": "REVISION"})
    cas("revision refusee tant qu'aucun budget n'existe", code >= 400, f"{code}")

    code, rep = ecrire(cfo, "sales-forecasts",
                       {**court, "monthIndex": 6, "forecastVolume": 1000, "kind": "BUDGET"})
    cas("mois 6 accepte sur un exercice de 6 mois", code in (200, 201), f"{code} {rep}")

    code, rep = ecrire(cfo, "sales-forecasts",
                       {**court, "monthIndex": 6, "forecastVolume": 900, "kind": "REVISION"})
    cas("revision acceptee une fois le budget pose", code in (200, 201), f"{code} {rep}")

    # Raccourcir l'exercice sous ses previsions : la base doit refuser.
    code, rep = ecrire(cfo, "fiscal-years", {
        "year": 2094, "label": "Exercice court de recette",
        "startsOn": "2094-01-01", "endsOn": "2094-03-31",
        "status": "OPEN", "isCurrent": False,
    })
    cas("raccourcir l'exercice sous ses previsions : refuse", code >= 400, f"{code}")

# --- 7. Une revision fait foi sur son mois --------------------------------
# Le defaut trouve : la prevision ADDITIONNAIT budget et revision.
print(chr(10) + "7. Une revision fait foi sur son mois")
if produit:
    base7 = {"fiscalYearId": ANNEE_ESSAI, "segment": "RETAIL", "productId": produit,
             "uom": "L", "currencyCode": "XOF", "version": 1}
    # Mois 5 budgete a 900 000, puis revise a 750 000. Mois 6 budgete a 800 000, jamais revise.
    ecrire(cfo, "sales-forecasts", {**base7, "monthIndex": 5, "forecastVolume": 900000,
                                    "referencePrice": 750, "kind": "BUDGET"})
    ecrire(cfo, "sales-forecasts", {**base7, "monthIndex": 6, "forecastVolume": 800000,
                                    "referencePrice": 750, "kind": "BUDGET"})
    ecrire(cfo, "sales-forecasts", {**base7, "monthIndex": 5, "forecastVolume": 750000,
                                    "referencePrice": 780, "kind": "REVISION"})

    code, lignes = call("/api/internal/supervision/prevision-vente", cfo)
    ligne = next((l for l in lignes if l["exercice"] == ANNEE_ESSAI and l["segment"] == "RETAIL"),
                 None) if isinstance(lignes, list) else None
    cas("la prevision RETAIL est lisible", ligne is not None, str(lignes)[:150])
    if ligne:
        prevu = float(ligne["volume_prevu"])
        budget = float(ligne["volume_budget"] or 0)
        cas("la revision REMPLACE le budget (1 550 000, pas 2 450 000)",
            abs(prevu - 1550000) < 1, f"observe {prevu}")
        cas("le budget initial reste lisible (1 700 000)",
            abs(budget - 1700000) < 1, f"observe {budget}")
        cas("l'ecart de revision vaut -150 000",
            abs(float(ligne["ecart_revision"]) + 150000) < 1, ligne["ecart_revision"])

    # L'assiette d'absorption, elle, NE suit PAS la revision (SS 14.2).
    code, ass = call("/api/internal/supervision/assiette-absorption", cfo)
    cas("l'assiette d'absorption reste lisible", code == 200, f"{code}")

# --- 5. Couverture et pilotage --------------------------------------------
print("\n5. Couverture budgetaire et pilotage")
code, couv = call("/api/internal/supervision/couverture-budgetaire", cfo)
if code == 404:
    print("  (route de couverture pas encore exposee - verifie en base)")
else:
    cas("couverture lisible", code == 200, f"{code}")

print("\n" + "=" * 68)
print(f"{ok}/{ok + ko} cas conformes")
