# -*- coding: utf-8 -*-
"""
RECETTE DES EXERCICES FISCAUX (ticket #7 - cycle de vie controle).

Regle de cloture retenue avec l'utilisateur (le ticket la laissait a
trancher avec le Directeur Financier) : un exercice ne peut cloturer
qu'apres sa date de fin, et dans l'ordre chronologique. La reouverture
reste possible mais reservee au DG, avec un motif trace.

Ce que ces cas prouvent :
  - un exercice ne peut pas cloturer avant sa date de fin ;
  - la cloture respecte l'ordre chronologique (un exercice anterieur
    encore ouvert bloque la cloture des suivants) ;
  - le verrou existant contre toute ecriture sur un exercice clos n'a
    pas regresse (non-modifie par ce ticket, juste revérifié) ;
  - la reouverture est reservee au DG et exige un motif ;
  - toute transition hors du cycle (directe PLANNED->CLOSED, ou vers le
    meme etat) est refusee.

Des millesimes tres eloignes de l'exercice courant seede (2026) evitent
toute interference avec les autres suites.
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


def creer_exercice(t, year, starts, ends, statut="PLANNED"):
    """Cree un exercice via le registre generique - toujours le seul moyen
    de CREER un exercice, le ticket #7 ne porte que sur ses transitions."""
    return call("/api/internal/parameters/fiscal-years", t, "POST", {
        "values": {
            "year": year, "label": f"Exercice de recette {year}",
            "startsOn": starts, "endsOn": ends,
            "status": statut, "isCurrent": False,
        },
        "reason": "recette exercices fiscaux",
    })


def trouver_id(t, year):
    code, exercices = call("/api/internal/fiscal-years", t)
    if code != 200:
        return None
    return next((e["id"] for e in exercices if e["year"] == year), None)


print("RECETTE DES EXERCICES FISCAUX")
print("=" * 68)
dg = token("dg@elyon-trading.example")
cfo = token("cfo@elyon-trading.example")
commercial = token("commercial@elyon-trading.example")

print("\n1. Cloture refusee avant la date de fin")

code, rep = creer_exercice(cfo, 2091, "2091-01-01", "2091-12-31")
cas("l'exercice de test se cree", code in (200, 201), f"{code} {rep}")
EX1 = trouver_id(dg, 2091)
cas("l'exercice cree est lisible sur l'ecran dedie", EX1 is not None, str(EX1))

if EX1:
    code, b = call(f"/api/internal/fiscal-years/{EX1}/statut", dg, "PATCH", {"to": "OPEN"})
    cas("ouverture acceptee (aucune condition prealable)", code == 200 and b.get("status") == "OPEN",
        f"{code} {b}")

    code, b = call(f"/api/internal/fiscal-years/{EX1}/statut", cfo, "PATCH", {"to": "CLOSED"})
    cas("cloture refusee avant la date de fin (2091 est loin devant)", code == 400, f"{code} {b}")

print("\n2. Cloture dans l'ordre chronologique")

creer_exercice(cfo, 2017, "2017-01-01", "2017-12-31")
creer_exercice(cfo, 2018, "2018-01-01", "2018-12-31")
EX_TOT, EX_TARD = trouver_id(dg, 2017), trouver_id(dg, 2018)
cas("les deux exercices anciens se creent", EX_TOT is not None and EX_TARD is not None,
    f"{EX_TOT} {EX_TARD}")

if EX_TOT and EX_TARD:
    call(f"/api/internal/fiscal-years/{EX_TOT}/statut", dg, "PATCH", {"to": "OPEN"})
    call(f"/api/internal/fiscal-years/{EX_TARD}/statut", dg, "PATCH", {"to": "OPEN"})

    code, b = call(f"/api/internal/fiscal-years/{EX_TARD}/statut", cfo, "PATCH", {"to": "CLOSED"})
    cas("2018 ne peut pas cloturer tant que 2017 est encore ouvert", code == 400, f"{code} {b}")

    code, b = call(f"/api/internal/fiscal-years/{EX_TOT}/statut", cfo, "PATCH", {"to": "CLOSED"})
    cas("2017 (le plus ancien) cloture", code == 200 and b.get("status") == "CLOSED", f"{code} {b}")

    code, b = call(f"/api/internal/fiscal-years/{EX_TARD}/statut", cfo, "PATCH", {"to": "CLOSED"})
    cas("2018 cloture desormais que 2017 ne bloque plus", code == 200 and b.get("status") == "CLOSED",
        f"{code} {b}")

print("\n3. Un exercice clos reste verrouille (trigger existant, non modifie)")

if EX_TOT:
    code, b = call("/api/internal/parameters/financing-rates", cfo, "POST", {
        "values": {"fiscalYearId": 2017, "annualRatePct": 9, "carryingDaysPerYear": 360,
                    "source": "recette", "version": 1, "isCurrent": True},
        "reason": "tentative sur exercice clos",
    })
    cas("ecriture budgetaire refusee sur un exercice clos", code >= 400, f"{code} {b}")

print("\n4. Reouverture reservee au DG, avec motif trace")

if EX_TOT:
    code, b = call(f"/api/internal/fiscal-years/{EX_TOT}/statut", cfo, "PATCH", {"to": "OPEN"})
    cas("la reouverture est refusee au CFO (reservee au DG)", code == 403, f"{code} {b}")

    code, b = call(f"/api/internal/fiscal-years/{EX_TOT}/statut", dg, "PATCH", {"to": "OPEN"})
    cas("la reouverture sans motif est refusee, meme au DG", code == 400, f"{code} {b}")

    code, b = call(f"/api/internal/fiscal-years/{EX_TOT}/statut", dg, "PATCH",
                   {"to": "OPEN", "reason": "Regularisation comptable de fin d'exercice - recette"})
    cas("la reouverture avec motif est acceptee au DG", code == 200 and b.get("status") == "OPEN",
        f"{code} {b}")

print("\n5. Transitions hors cycle refusees")

code, rep = creer_exercice(cfo, 2016, "2016-01-01", "2016-12-31")
EX_DIRECT = trouver_id(dg, 2016)
if EX_DIRECT:
    code, b = call(f"/api/internal/fiscal-years/{EX_DIRECT}/statut", dg, "PATCH", {"to": "CLOSED"})
    cas("passage direct EN_PREPARATION -> CLOS refuse", code == 400, f"{code} {b}")

    call(f"/api/internal/fiscal-years/{EX_DIRECT}/statut", dg, "PATCH", {"to": "OPEN"})
    code, b = call(f"/api/internal/fiscal-years/{EX_DIRECT}/statut", dg, "PATCH", {"to": "OPEN"})
    cas("repasser au meme etat est refuse", code == 400, f"{code} {b}")

print("\n6. Acces reserve a la direction et la finance")

code, b = call("/api/internal/fiscal-years", commercial)
cas("la lecture est refusee au commercial", code == 403, f"{code} {b}")

code, b = call(f"/api/internal/fiscal-years/{EX_DIRECT}/statut", commercial, "PATCH", {"to": "CLOSED"})
cas("la transition est refusee au commercial", code == 403, f"{code} {b}")

print("\n" + "=" * 68)
print(f"{ok}/{ok + ko} cas conformes")
