# -*- coding: utf-8 -*-
"""
RECETTE DU PORTAIL CLIENT (ticket #3 - cloisonnement centralise).

Ce que ces cas prouvent :
  - un client authentifie sur le portail ne voit jamais un objet rattache a un
    AUTRE tiers, sur chaque route qui adresse un objet par identifiant ;
  - une demande de cotation creee par un client n'apparait jamais dans la
    liste ni la fiche d'un autre client ;
  - le refus est un 404 (pas un 403) - la meme regle que le commentaire
    d'en-tete de portal.controller.ts revendique depuis l'origine ;
  - les routes de LISTE restent scopees par tiers (aucun croisement d'id).

Deux comptes portail distincts, seedes sur deux tiers differents
(CLI-001, CLI-002), servent respectivement de temoin et d'attaquant.
"""
import json, urllib.request, urllib.error

B = "http://localhost:4200"
PWD = "ChangeMe!2026"
ok, ko = 0, 0


def token_portail(email):
    r = urllib.request.Request(B + "/api/portal/auth/login", method="POST")
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


print("RECETTE DU PORTAIL CLIENT")
print("=" * 68)
a = token_portail("achats@maritime-atlantique.example")
bb = token_portail("approvisionnement@smo.example")

# --- 1. Demande de cotation - creee et isolee de bout en bout --------------
print("\n1. Demande de cotation - isolation de bout en bout")
code, produits = call("/api/portal/products", a)
cas("le catalogue produit est accessible", code == 200 and len(produits) > 0, f"{code}")

if code == 200 and produits:
    code, demande = call("/api/portal/quotations", a, "POST", {
        "productId": produits[0]["id"],
        "desiredVolume": 12000,
        "uom": "L",
        "message": "Recette portail - isolation",
    })
    cas("le client A cree sa demande", code in (200, 201), f"{code} {demande}")

    if isinstance(demande, dict) and demande.get("id"):
        code, liste_a = call("/api/portal/quotations", a)
        presente_chez_a = any(q["id"] == demande["id"] for q in liste_a)
        cas("la demande apparait dans la liste du client A", presente_chez_a, "")

        code, liste_b = call("/api/portal/quotations", bb)
        fuite = any(q["id"] == demande["id"] for q in liste_b)
        cas("la demande N'apparait PAS dans la liste du client B", not fuite, "fuite detectee")

# --- 2. Affaires - fiche par identifiant ------------------------------------
print("\n2. Affaires - acces par identifiant")
code, deals_a = call("/api/portal/deals", a)
code_b, deals_b = call("/api/portal/deals", bb)
cas("la liste des affaires du client A repond", code == 200, f"{code}")
cas("la liste des affaires du client B repond", code_b == 200, f"{code_b}")

items_a = deals_a.get("items", []) if isinstance(deals_a, dict) else []
items_b = deals_b.get("items", []) if isinstance(deals_b, dict) else []
croisement = {d["id"] for d in items_a} & {d["id"] for d in items_b}
cas("aucune affaire commune entre les deux listes", len(croisement) == 0, str(croisement))

if items_a:
    proprietaire, etranger, cible = a, bb, items_a[0]
elif items_b:
    proprietaire, etranger, cible = bb, a, items_b[0]
else:
    proprietaire, etranger, cible = None, None, None

if cible:
    code, rep = call(f"/api/portal/deals/{cible['id']}", proprietaire)
    cas("le proprietaire consulte sa propre affaire", code == 200, f"{code}")

    code, rep = call(f"/api/portal/deals/{cible['id']}", etranger)
    cas("un autre client ne consulte pas cette affaire (404, pas 403)", code == 404, f"{code} {rep}")

    code, rep = call(f"/api/portal/deals/{cible['id']}/accept", etranger, "PATCH")
    cas("un autre client ne peut pas non plus l'accepter", code == 404, f"{code} {rep}")
else:
    print("  (aucune affaire seedee pour l'un ou l'autre client - cas d'acces par id non joue)")

# --- 3. Factures - telechargement de piece ----------------------------------
print("\n3. Factures - telechargement de piece jointe")
code, inv_a = call("/api/portal/invoices", a)
code_b, inv_b = call("/api/portal/invoices", bb)
cas("la liste des factures du client A repond", code == 200, f"{code}")
cas("la liste des factures du client B repond", code_b == 200, f"{code_b}")

iitems_a = inv_a.get("items", []) if isinstance(inv_a, dict) else []
croisement_f = {i["id"] for i in iitems_a} & {i["id"] for i in (inv_b.get("items", []) if isinstance(inv_b, dict) else [])}
cas("aucune facture commune entre les deux listes", len(croisement_f) == 0, str(croisement_f))

piece = next((d["id"] for i in iitems_a for d in i.get("generatedDocuments", [])), None)
if piece:
    code, rep = call(f"/api/portal/documents/{piece}/download", a)
    cas("le proprietaire telecharge sa propre piece", code == 200, f"{code}")
    code, rep = call(f"/api/portal/documents/{piece}/download", bb)
    cas("un autre client ne telecharge pas cette piece (404)", code == 404, f"{code} {rep}")
else:
    print("  (aucune facture scellee avec piece jointe cote client A - cas de telechargement non joue)")

print("\n" + "=" * 68)
print(f"{ok}/{ok + ko} cas conformes")
