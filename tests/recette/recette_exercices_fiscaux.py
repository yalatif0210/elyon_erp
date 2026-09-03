# -*- coding: utf-8 -*-
"""
RECETTE DES EXERCICES FISCAUX (ticket #7 - cycle de vie controle,
ticket #10 - seule voie d'ecriture desormais).

Regle de cloture retenue avec l'utilisateur (le ticket #7 la laissait a
trancher avec le Directeur Financier) : un exercice ne peut cloturer
qu'apres sa date de fin, et dans l'ordre chronologique. La reouverture
reste possible mais reservee au DG, avec un motif trace.

Ce que ces cas prouvent :
  - la creation ET les transitions passent desormais exclusivement par
    l'ecran dedie (POST /api/internal/fiscal-years) - le registre
    generique refuse tout le monde sur cette table depuis le ticket #10 ;
  - un exercice ne peut pas cloturer avant sa date de fin ;
  - la cloture respecte l'ordre chronologique (un exercice anterieur
    encore ouvert bloque la cloture des suivants) ;
  - le verrou existant contre toute ecriture sur un exercice clos n'a
    pas regresse (non-modifie par ce ticket, juste revérifié) ;
  - la reouverture est reservee au DG et exige un motif ;
  - toute transition hors du cycle (directe PLANNED->CLOSED, ou vers le
    meme etat) est refusee.

Millesimes TIRES AU HASARD, mais AVANT l'exercice 2026 seede (jamais
apres) : l'exercice 2026 est reellement OUVERT dans les donnees de
seed, et la regle de cloture chronologique le traite comme n'importe
quel autre exercice - un millesime de test superieur a 2026 se
retrouverait TOUJOURS bloque en cloture par lui ("2026 est encore
ouvert"), ce qui n'est pas ce que ces cas veulent eprouver. Une plage
1000-1900 offre assez de recul pour ne jamais collisionner d'un
passage local a l'autre - la creation dediee ne reinitialise plus le
statut sur rejeu (ticket #10, contrairement a l'ancien registre
generique), le millesime doit donc etre neuf a chaque fois.
"""
import json, random, urllib.request, urllib.error

B = "http://localhost:4200"
PWD = "ChangeMe!2026"
ok, ko = 0, 0
BASE = random.randint(1000, 1900)


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


def creer_exercice(t, year, starts, ends):
    """Seule voie de creation depuis le ticket #10 - toujours PLANNED,
    aucun statut ne se choisit a la creation."""
    return call("/api/internal/fiscal-years", t, "POST", {
        "year": year, "label": f"Exercice de recette {year}",
        "startsOn": starts, "endsOn": ends,
    })


print("RECETTE DES EXERCICES FISCAUX")
print("=" * 68)
dg = token("dg@elyon-trading.example")
cfo = token("cfo@elyon-trading.example")
commercial = token("commercial@elyon-trading.example")

print("\n0. La creation ne passe plus par le registre generique")

code, catalogue = call("/api/internal/parameters", dg)
cles = {spec["key"] for spec in catalogue} if code == 200 else set()
cas("'fiscal-years' n'apparait plus au catalogue generique (DG)", "fiscal-years" not in cles,
    str(sorted(cles))[:200])
cas("les AUTRES referentiels restent au catalogue (non-regression)",
    "partners" in cles and "products" in cles, str(sorted(cles))[:200])

code, b = call("/api/internal/parameters/fiscal-years", cfo, "POST", {
    "values": {"year": BASE, "label": "Tentative registre generique",
               "startsOn": "2030-01-01", "endsOn": "2030-12-31", "status": "PLANNED"},
    "reason": "recette - doit etre refuse",
})
cas("le registre generique refuse desormais TOUTE ecriture sur les exercices (ticket #10)",
    code == 403, f"{code} {b}")

print("\n1. Cloture refusee avant la date de fin")

# Millesime le PLUS ELEVE de cette suite : cet exercice reste OUVERT jusqu'a
# la fin du fichier (sa cloture est refusee par construction - c'est le cas
# teste). Un exercice ouvert plus petit bloque la cloture de tout exercice
# plus grand (§ 2 ci-dessous) : celui-ci doit donc etre le plus grand de
# tous, sous peine de bloquer ses propres voisins.
code, rep = creer_exercice(cfo, BASE + 10, "2091-01-01", "2091-12-31")
cas("l'exercice de test se cree via l'ecran dedie", code == 201, f"{code} {rep}")
EX1 = rep.get("id") if isinstance(rep, dict) else None
cas("il nait EN PREPARATION, jamais un autre statut", rep.get("status") == "PLANNED", str(rep))

if EX1:
    code, b = call(f"/api/internal/fiscal-years/{EX1}/statut", dg, "PATCH", {"to": "OPEN"})
    cas("ouverture acceptee (aucune condition prealable)", code == 200 and b.get("status") == "OPEN",
        f"{code} {b}")

    code, b = call(f"/api/internal/fiscal-years/{EX1}/statut", cfo, "PATCH", {"to": "CLOSED"})
    cas("cloture refusee avant la date de fin (loin devant)", code == 400, f"{code} {b}")

print("\n2. Cloture dans l'ordre chronologique")

# Les DEUX PLUS PETITS millesimes de la suite : rien de plus ancien qu'eux ne
# reste ouvert ailleurs dans ce fichier, condition necessaire pour que leur
# propre cloture puisse reellement aboutir plus bas.
_, tot = creer_exercice(cfo, BASE + 1, "2017-01-01", "2017-12-31")
_, tard = creer_exercice(cfo, BASE + 2, "2018-01-01", "2018-12-31")
EX_TOT = tot.get("id") if isinstance(tot, dict) else None
EX_TARD = tard.get("id") if isinstance(tard, dict) else None
cas("les deux exercices anciens se creent", EX_TOT is not None and EX_TARD is not None,
    f"{EX_TOT} {EX_TARD}")

if EX_TOT and EX_TARD:
    call(f"/api/internal/fiscal-years/{EX_TOT}/statut", dg, "PATCH", {"to": "OPEN"})
    call(f"/api/internal/fiscal-years/{EX_TARD}/statut", dg, "PATCH", {"to": "OPEN"})

    code, b = call(f"/api/internal/fiscal-years/{EX_TARD}/statut", cfo, "PATCH", {"to": "CLOSED"})
    cas(f"l'exercice {BASE + 2} ne peut pas cloturer tant que {BASE + 1} est encore ouvert",
        code == 400, f"{code} {b}")

    code, b = call(f"/api/internal/fiscal-years/{EX_TOT}/statut", cfo, "PATCH", {"to": "CLOSED"})
    cas(f"{BASE + 1} (le plus ancien) cloture", code == 200 and b.get("status") == "CLOSED", f"{code} {b}")

    code, b = call(f"/api/internal/fiscal-years/{EX_TARD}/statut", cfo, "PATCH", {"to": "CLOSED"})
    cas(f"{BASE + 2} cloture desormais que {BASE + 1} ne bloque plus",
        code == 200 and b.get("status") == "CLOSED", f"{code} {b}")

print("\n3. Un exercice clos reste verrouille (trigger existant, non modifie)")

if EX_TOT:
    code, b = call("/api/internal/parameters/financing-rates", cfo, "POST", {
        "values": {"fiscalYearId": BASE + 1, "annualRatePct": 9, "carryingDaysPerYear": 360,
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

code, rep = creer_exercice(cfo, BASE + 4, "2016-01-01", "2016-12-31")
EX_DIRECT = rep.get("id") if isinstance(rep, dict) else None
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

code, b = call("/api/internal/fiscal-years", commercial, "POST", {
    "year": BASE + 5, "label": "Tentative commercial", "startsOn": "2030-01-01", "endsOn": "2030-12-31",
})
cas("la creation est refusee au commercial", code == 403, f"{code} {b}")

print("\n" + "=" * 68)
print(f"{ok}/{ok + ko} cas conformes")
