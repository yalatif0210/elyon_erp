# -*- coding: utf-8 -*-
"""
RECETTE DES GARANTIES BANCAIRES (ticket #6 - cycle de vie controle).

Ce que ces cas prouvent :
  - une garantie se cree EN ATTENTE, jamais directement active ou consommee ;
  - le cycle controle est en attente -> active -> consommee/echue, avec
    annulation possible tant que rien n'est consomme ni echu ;
  - toute transition hors de ce cycle est refusee avec un message clair,
    notamment reprendre une garantie deja consommee (le cas cite par le
    ticket) et retourner en arriere depuis ACTIVE ;
  - le montant en devise pivot est calcule en base, jamais saisi ;
  - l'ecran est refuse au commercial (lecture et ecriture).
"""
import json, urllib.request, urllib.error
from uuid import uuid4

RUN = uuid4().hex[:8].upper()
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


print("RECETTE DES GARANTIES BANCAIRES")
print("=" * 68)
dg = token("dg@elyon-trading.example")
cfo = token("cfo@elyon-trading.example")
commercial = token("commercial@elyon-trading.example")

_, tiers = call("/api/internal/referentials/partners?type=CLIENT&pageSize=1", dg)
client = tiers["items"][0]

print("\n1. Creation - toujours EN ATTENTE")

code, g = call("/api/internal/guarantees", cfo, "POST", {
    "reference": f"GAR-{RUN}-001",
    "partnerId": client["id"],
    "type": "BANK_GUARANTEE",
    "amount": 5_000_000,
    "currencyCode": "XOF",
    "issuingBank": "Banque de recette",
    "issueDate": "2026-08-01",
    "expiryDate": "2027-08-01",
})
cas("la garantie se cree", code == 201, f"{code} {g}")
cas("statut initial EN ATTENTE, jamais actif d'emblee", g.get("status") == "PENDING", str(g.get("status")))
GID = g.get("id")

cas("montant pivot calcule en base, jamais saisi", float(g.get("amountPivot", 0)) > 0,
    f"amountPivot={g.get('amountPivot')}")

print("\n2. Cycle controle : en attente -> active -> consommee")

code, b = call(f"/api/internal/guarantees/{GID}/statut", cfo, "PATCH", {"to": "CONSUMED"})
cas("sauter directement a CONSOMMEE est refuse", code == 400, f"{code} {b}")

code, b = call(f"/api/internal/guarantees/{GID}/statut", cfo, "PATCH", {"to": "ACTIVE"})
cas("activation acceptee", code == 200 and b.get("status") == "ACTIVE", f"{code} {b}")

code, b = call(f"/api/internal/guarantees/{GID}/statut", cfo, "PATCH", {"to": "PENDING"})
cas("retour en arriere depuis ACTIVE refuse", code == 400, f"{code} {b}")

code, b = call(f"/api/internal/guarantees/{GID}/statut", cfo, "PATCH", {"to": "CONSUMED"})
cas("passage a CONSOMMEE accepte", code == 200 and b.get("status") == "CONSUMED", f"{code} {b}")

print("\n3. Une garantie consommee est un etat terminal")

code, b = call(f"/api/internal/guarantees/{GID}/statut", cfo, "PATCH", {"to": "ACTIVE"})
cas("reprendre une garantie deja consommee est refuse (cas cite par le ticket)",
    code == 400, f"{code} {b}")

code, b = call(f"/api/internal/guarantees/{GID}/statut", cfo, "PATCH", {"to": "EXPIRED"})
cas("aucune autre transition n'est possible depuis CONSOMMEE", code == 400, f"{code} {b}")

print("\n4. Annulation possible tant que rien n'est consomme ni echu")

code, g2 = call("/api/internal/guarantees", dg, "POST", {
    "reference": f"GAR-{RUN}-002",
    "partnerId": client["id"],
    "type": "DOWN_PAYMENT",
    "amount": 1_200_000,
    "currencyCode": "XOF",
    "issueDate": "2026-08-15",
})
GID2 = g2.get("id")
code, b = call(f"/api/internal/guarantees/{GID2}/statut", dg, "PATCH", {"to": "CANCELLED"})
cas("une garantie en attente peut etre annulee", code == 200 and b.get("status") == "CANCELLED",
    f"{code} {b}")

print("\n5. Registre et acces")

code, reg = call(f"/api/internal/guarantees?search=GAR-{RUN}", cfo)
cas("le registre est lisible par la finance", code == 200 and reg["total"] >= 2, f"{code} {reg}")

code, b = call("/api/internal/guarantees", commercial, "POST", {
    "reference": f"GAR-{RUN}-003", "partnerId": client["id"], "type": "BANK_GUARANTEE",
    "amount": 100, "currencyCode": "XOF", "issueDate": "2026-08-15",
})
cas("la creation est refusee au commercial", code == 403, f"{code} {b}")

code, b = call("/api/internal/guarantees", commercial)
cas("la lecture du registre est refusee au commercial", code == 403, f"{code} {b}")

print("\n" + "=" * 68)
print(f"{ok}/{ok + ko} cas conformes")
