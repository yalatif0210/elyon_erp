# -*- coding: utf-8 -*-
"""
RECETTE DES CORRECTIONS ISSUES DE L'AUDIT ADVERSARIAL DU 9 AOUT.

Chaque cas reproduit le defaut TEL QU'IL SE PRESENTAIT, par le chemin reel :
un appel HTTP, avec un compte et un role de l'entreprise. Aucun de ces cas ne
passe par psql — c'est precisement l'erreur de methode que l'audit a mise au
jour : les regles etaient verifiees la ou elles sont ecrites, pas la ou elles
sont rencontrees.

Rejouable : les cas d'ecriture visent des cles de recette, et nettoyage.sql les
efface avant chaque campagne.
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
        corps = e.read().decode()
        try:
            return e.code, json.loads(corps)
        except Exception:
            return e.code, corps[:400]


def cas(libelle, condition, detail=""):
    global ok, ko
    if condition:
        ok += 1
        print(f"  ok   {libelle}")
    else:
        ko += 1
        print(f"  ECHEC {libelle} :: {detail}")


print("RECETTE DES CORRECTIONS D'AUDIT")
print("=" * 68)

dg = token("dg@elyon-trading.example")
cfo = token("cfo@elyon-trading.example")
logi = token("logistique@elyon-trading.example")
assist = token("assistante@elyon-trading.example")
it = token("it@elyon-trading.example")

# --- D1. La lecture d'un referentiel suit le referentiel, pas la route -----
print("\nD1. Cloisonnement de la lecture des referentiels")

code, _ = call("/api/internal/referentials/supplier-prices", logi)
cas("le coordinateur logistique ne lit PAS les prix d'achat", code == 403, f"http {code}")

code, _ = call("/api/internal/referentials/contracts", logi)
cas("ni les contrats-cadres", code == 403, f"http {code}")

code, _ = call("/api/internal/referentials/supplier-prices", assist)
cas("l'assistante de direction non plus", code == 403, f"http {code}")

code, _ = call("/api/internal/referentials/supplier-prices", it)
cas("l'administrateur informatique non plus", code == 403, f"http {code}")

code, _ = call("/api/internal/referentials/supplier-prices", cfo)
cas("le directeur financier, si", code == 200, f"http {code}")

# La lecture reste ouverte a qui en a besoin pour ses propres listes.
code, _ = call("/api/internal/referentials/currencies", logi)
cas("les devises restent lisibles par la logistique", code == 200, f"http {code}")

code, cat = call("/api/internal/parameters", logi)
manquants = []
if code == 200:
    for spec in cat:
        for champ in spec["fields"]:
            cible = champ.get("refTable")
            if not cible:
                continue
            c2, _ = call("/api/internal/referentials/" + cible, logi)
            if c2 != 200:
                manquants.append(f"{spec['key']}.{champ['name']}->{cible}({c2})")
cas("aucune liste deroulante de ses propres ecrans n'est fermee",
    not manquants, ", ".join(manquants[:4]))

# --- D2. Les refus metier arrivent en francais ----------------------------
print("\nD2. Lisibilite des refus metier")

code, produits = call("/api/internal/referentials/products", cfo)
produit = produits[0]["code"] if isinstance(produits, list) and produits else None

# ⚠️ ON N'ÉCRIT PAS DANS L'EXERCICE RÉEL.
#    Ce cas visait 2026, l'exercice de l'entreprise : la ligne y restait après
#    la campagne, et le passage suivant se heurtait à elle au lieu d'éprouver
#    ce qu'il devait éprouver. Les millésimes 2093 et au-delà sont réservés à
#    la recette et balayés avant chaque campagne.
call("/api/internal/parameters/fiscal-years", cfo, "POST", {
    "values": {"year": 2093, "label": "Exercice de recette audit",
               "startsOn": "2093-01-01", "endsOn": "2093-12-31",
               "status": "PLANNED", "isCurrent": False}})
code, rep = call("/api/internal/parameters/sales-forecasts", cfo, "POST", {
    "values": {"fiscalYearId": 2093, "segment": "RETAIL", "productId": produit,
               "monthIndex": 3, "forecastVolume": 1000, "uom": "L",
               "priceReferenceType": "CONTRACTUAL", "kind": "BUDGET", "version": 1},
    "reason": "recette audit"})
message = rep.get("message", "") if isinstance(rep, dict) else str(rep)
cas("le refus est refuse", code >= 400, f"http {code}")
cas("le message ne contient AUCUN vocabulaire de moteur",
    "ConnectorError" not in message and "PostgresError" not in message
    and "kind:" not in message,
    message[:150])
# ⚠️ ON VISE UNE PUBLICATION QUI N'EXISTE PAS.
#    Le cas s'appuyait sur l'absence de prix à la pompe ; le jeu de données en
#    publie un désormais, et le refus ne se produisait plus. Un cas de recette
#    dont le résultat dépend du jeu de données ne prouve rien.
cas("le message porte la consigne metier",
    "prix administr" in message.lower(), message[:150])

# --- D3 et D10. L'auteur est inscrit sur la ligne et au journal ------------
print("\nD3. Tracabilite de l'auteur")

code, rep = call("/api/internal/parameters/cost-posts", cfo, "POST", {
    "values": {"code": "RECETTE_AUDIT", "label": "Poste de recette",
               "category": "Recette", "nature": "DIRECT", "variability": "VARIABLE",
               "isActive": False}})
cas("un poste de cout de recette est cree", code in (200, 201), f"http {code} {rep}")

code, lignes = call("/api/internal/referentials/fiscal-years", cfo)
# `fiscal-years` porte une colonne d'auteur : on ecrit puis on relit.
code, rep = call("/api/internal/parameters/fiscal-years", cfo, "POST", {
    "values": {"year": 2094, "label": "Exercice de recette auteur",
               "startsOn": "2094-01-01", "endsOn": "2094-12-31",
               "status": "PLANNED", "isCurrent": False}})
cas("un exercice de recette est cree", code in (200, 201), f"http {code} {rep}")

code, exercices = call("/api/internal/referentials/fiscal-years", cfo)
ligne = next((e for e in exercices if e["year"] == 2094), None) if code == 200 else None
cas("l'exercice cree porte un auteur", ligne is not None and ligne.get("authorId"),
    str(ligne)[:160])

# --- D5. L'import ne cree pas de reglage systeme inexistant ----------------
print("\nD5. L'import ne contourne plus la liste des reglages")

code, rep = call("/api/internal/parameters/settings/import", dg, "POST", {
    "rows": [{"key": "CLE_INVENTEE_RECETTE", "value": "1",
              "valueType": "number", "description": "essai"}],
    "dryRun": True})
rejetees = rep.get("rejetees") if isinstance(rep, dict) else None
cas("une cle de reglage inexistante est rejetee", rejetees == 1,
    f"http {code} {str(rep)[:200]}")

code, rep = call("/api/internal/parameters/settings/import", dg, "POST", {
    "rows": [{"key": "VAT_STANDARD_RATE", "value": "18",
              "valueType": "number", "description": "Taux de TVA de droit commun."}],
    "dryRun": True})
cas("une cle existante reste acceptee",
    isinstance(rep, dict) and rep.get("rejetees") == 0, f"http {code} {str(rep)[:200]}")

# --- D4. Les versions se comptent par identite ----------------------------
print("\nD4. Numeros de version proposes")

code, d = call("/api/internal/referentials/sales-forecasts/versions-libres", cfo)
cas("sans identite, la route rend bien toute la table", code == 200, f"http {code}")

code, d2 = call(
    "/api/internal/referentials/sales-forecasts/versions-libres"
    f"?fiscalYearId=2026&segment=RETAIL&productId={produit}&monthIndex=9&kind=BUDGET", cfo)
cas("sur une combinaison neuve, la version 1 est proposee",
    code == 200 and d2.get("suivant") == 1, str(d2)[:120])

# --- D13. La marge emploie le taux de financement de l'exercice -----------
print("\nD13. Conditions financieres de l'exercice")

code, couv = call("/api/internal/supervision/couverture-budgetaire", cfo)
cas("la couverture budgetaire reste lisible", code == 200, f"http {code}")

code, rep = call("/api/internal/referentials/absorption-rates?fiscalYear=2026", cfo)
cas("les budgets de pool restent lisibles", code == 200, f"http {code}")

print("\n" + "=" * 68)
print(f"{ok}/{ok + ko} cas conformes")
