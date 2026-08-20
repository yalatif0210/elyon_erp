# -*- coding: utf-8 -*-
"""
RECETTE — PARCOURS TERRAIN COMPLET
Réf. SPECIFICATIONS.md § 7, § 10

Rejoue, dans l'ordre, ce que fait un agent sur site puis un contrôleur HSE
à distance, en passant par les MÊMES routes que la tablette :

  ouvrir une checklist → renseigner ses points → joindre une photo →
  relever un volume → tenter de valider soi-même → laisser le contrôleur
  valider → faire avancer l'opération.

C'est le seul moyen de vérifier que la séparation des tâches tient sur le
chemin réel, et pas seulement dans les tests unitaires de chaque brique.
"""
import io
import json
import pathlib
import subprocess
import urllib.error
import urllib.request
import uuid
import zlib
from datetime import datetime, timezone

# Racine du dépôt, calculée depuis ce fichier - jamais un chemin personnel
# codé en dur, qui ne survit qu'au poste de qui l'a écrit.
DEPOT = pathlib.Path(__file__).resolve().parents[2]

B = "http://localhost:4200"
PWD = "ChangeMe!2026"
OK = FAIL = 0
APPAREIL = "tablette-" + uuid.uuid4().hex[:8]
RANG = [0]


def call(m, p, tok=None, body=None):
    r = urllib.request.Request(B + p, method=m)
    r.add_header("Content-Type", "application/json")
    if tok:
        r.add_header("Authorization", "Bearer " + tok)
    d = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(r, d) as x:
            return x.status, json.loads(x.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except Exception:
            return e.code, {"message": raw.decode("utf-8", "replace")[:300]}


def check(label, cond, detail=""):
    global OK, FAIL
    if cond:
        OK += 1
        print(f"  OK    {label}")
    else:
        FAIL += 1
        print(f"  ECHEC {label}")
    if detail:
        print(f"          {detail}")


def msg(b):
    m = b.get("message")
    return (m if isinstance(m, str) else " · ".join(map(str, m or [])))[:170]


def sync(tok, op, type_, payload):
    """Un envoi, comme la file de la tablette le compose."""
    RANG[0] += 1
    s, rep = call("POST", "/api/field/sync", tok, {"deviceId": APPAREIL, "events": [{
        "id": str(uuid.uuid4()), "operationId": op, "type": type_, "payload": payload,
        "sequence": RANG[0],
        "deviceTimestamp": datetime.now(timezone.utc).isoformat()}]})
    sort = (rep.get("outcomes") or [{}])[0]
    return sort.get("status"), sort.get("reason", "")


def png():
    def bloc(nom, d):
        c = nom + d
        return len(d).to_bytes(4, "big") + c + (zlib.crc32(c) & 0xFFFFFFFF).to_bytes(4, "big")
    return (b"\x89PNG\r\n\x1a\n"
            + bloc(b"IHDR", (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + bytes([8, 2, 0, 0, 0]))
            + bloc(b"IDAT", zlib.compress(bytes([0, 3, 4, 5])))
            + bloc(b"IEND", b""))


def multipart(tok, champs, contenu):
    lim = "----r" + uuid.uuid4().hex
    c = io.BytesIO()
    for k, v in champs.items():
        c.write(f"--{lim}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    c.write(f"--{lim}\r\n".encode())
    c.write(b'Content-Disposition: form-data; name="file"; filename="p.png"\r\n')
    c.write(b"Content-Type: image/png\r\n\r\n" + contenu + b"\r\n")
    c.write(f"--{lim}--\r\n".encode())
    r = urllib.request.Request(B + "/api/field/attachments", method="POST", data=c.getvalue())
    r.add_header("Content-Type", f"multipart/form-data; boundary={lim}")
    r.add_header("Authorization", "Bearer " + tok)
    try:
        with urllib.request.urlopen(r) as x:
            return x.status, json.loads(x.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def psql(sql):
    o = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "erp_migrator",
         "-d", "erp", "-t", "-A", "-c", sql],
        cwd=str(DEPOT),
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (o.stdout or "") + (o.stderr or "")


print("=" * 74)
print("  RECETTE — PARCOURS TERRAIN COMPLET")
print("=" * 74)

logi = call("POST", "/api/internal/auth/login", None,
            {"email": "logistique@elyon-trading.example", "password": PWD})[1]["accessToken"]
agent = call("POST", "/api/field/auth/login", None,
             {"email": "agent.terrain@elyon-trading.example", "password": PWD})[1]["accessToken"]
controleur = call("POST", "/api/field/auth/login", None,
                  {"email": "hse@elyon-trading.example", "password": PWD})[1]["accessToken"]
agent_id = psql("select id from field_users where email='agent.terrain@elyon-trading.example';").strip()

s, ops = call("GET", "/api/internal/operations?search=OP-2026-000001", logi)
ref = ops["items"][0]
s, det = call("GET", f"/api/internal/operations/{ref['id']}", logi)
s, types = call("GET", "/api/internal/referentials/operation-types", logi)
route = next(t["id"] for t in types if t["code"] == "ROUTE")

s, op = call("POST", "/api/internal/operations", logi, {
    "dealId": det["dealId"], "plannedVolume": 28000, "uom": "L", "transportMode": "TRUCK",
    "originLocation": "Dépôt SIR — Abidjan", "destinationLocation": "Site minier — Man",
    "operationTypeIds": [route], "fieldAgentId": agent_id})
op_id = op["id"]
print(f"\n  Opération de recette : {op['reference']}\n")

print("=== A. L'AGENT PREND SON TRAVAIL ===")
s, liste = call("GET", "/api/field/operations", agent)
check("L'opération figure dans sa liste de travail",
      s == 200 and any(o["id"] == op_id for o in liste), f"{len(liste)} opération(s)")

s, dossier = call("GET", f"/api/field/operations/{op_id}", agent)
check("Le dossier s'ouvre", s == 200 and dossier.get("reference") == op["reference"],
      f"client {dossier.get('clientLegalName')} · {dossier.get('plannedVolume')} {dossier.get('uom')}")

interdits = ["price", "margin", "cost", "purchase", "credit", "invoice",
             "prix", "marge", "cout", "encours"]
brut = json.dumps(dossier).lower()
fuites = [m for m in interdits if m in brut]
check("Aucune donnée commerciale dans l'objet terrain", not fuites,
      f"fuites : {fuites}" if fuites else "ni prix, ni marge, ni coût, ni encours (§ 10.3)")

print("\n=== B. CHECKLIST ===")
st, m = sync(agent, op_id, "CHECK_OPENED", {"phase": "PRE_DEPARTURE"})
check("Checklist ouverte", st == "ACCEPTED", m or "phase avant départ")

s, checks = call("GET", f"/api/field/hse/operations/{op_id}/checks", agent)
c = next((x for x in checks if x["phase"] == "PRE_DEPARTURE"), None)
check("Elle est lisible avec ses points", c is not None and len(c["items"]) > 0,
      f"{len(c['items']) if c else 0} point(s)")

bloquants = [p for p in c["items"] if p["level"] == "BLOCKING"]
check("Des points bloquants y figurent", len(bloquants) > 0,
      f"{len(bloquants)} bloquant(s) — ils empêchent le chargement tant qu'ils ne sont pas satisfaits")

print("\n=== C. RENSEIGNEMENT ET PHOTO ===")
premier = c["items"][0]

# ⚠️ LA PHOTO D'ABORD, LE POINT ENSUITE.
#
#    Décision de la direction du 6 août 2026 : l'exigence de photo mord À
#    L'ENREGISTREMENT. La base refuse le point tant qu'aucune pièce ne lui est
#    rattachée. C'est le déroulé réel sur le terrain — on photographie ce qu'on
#    constate, puis on conclut — et la file des photos étant distincte de celle
#    des événements, le cliché part sans attendre.
s, photo = multipart(agent, {"clientUuid": str(uuid.uuid4()), "checkItemId": premier["id"],
                             "caption": "Preuve du contrôle"}, png())
check("Une photo se rattache au point", s in (200, 201) and photo.get("sha256"),
      f"empreinte {str(photo.get('sha256'))[:16]}… — hors du flux d'événements (§ 10.2)")

st, m = sync(agent, op_id, "CHECK_ITEM_RECORDED",
             {"checkItemId": premier["id"], "outcome": "PASSED",
              "recordedValue": "Contrôlé", "comment": "Conforme"})
check("Le point s'enregistre, photo reçue", st == "ACCEPTED",
      m or premier["item"]["label"][:70])

# Et sans photo, il ne s'enregistre pas : la règle mord, elle ne décore pas.
sans_photo = next((p for p in c["items"][1:]
                   if p["item"].get("photoPolicy") == "REQUIRED"), None)
if sans_photo:
    st, m = sync(agent, op_id, "CHECK_ITEM_RECORDED",
                 {"checkItemId": sans_photo["id"], "outcome": "PASSED"})
    check("Sans photo, le point est REFUSÉ", st == "REJECTED", m[:150])

# ⚠️ Chaque point à photo EXIGÉE reçoit d'abord son cliché : depuis le 6 août
#    2026, la base refuse de l'enregistrer sans. C'est le déroulé réel — on
#    photographie ce qu'on constate, puis on conclut.
for p in c["items"][1:]:
    if p["item"].get("photoPolicy") == "REQUIRED":
        multipart(agent, {"clientUuid": str(uuid.uuid4()), "checkItemId": p["id"],
                          "kind": "PHOTO"}, png())
    # ⚠️ Une SIGNATURE ne se satisfait pas d'une photo, et c'est tout l'objet
    #    de la nature de pièce : le point « bon de livraison signé par le
    #    client » n'est pas rempli par un cliché du camion.
    if p["item"].get("requiresSignature"):
        multipart(agent, {"clientUuid": str(uuid.uuid4()), "checkItemId": p["id"],
                          "kind": "SIGNATURE"}, png())
    charge = {"checkItemId": p["id"], "outcome": "PASSED"}
    if p["item"].get("requiresValue"):
        charge["recordedValue"] = "Relevé conforme"
    sync(agent, op_id, "CHECK_ITEM_RECORDED", charge)
s, checks = call("GET", f"/api/field/hse/operations/{op_id}/checks", agent)
c = next(x for x in checks if x["phase"] == "PRE_DEPARTURE")
restants = [p for p in c["items"] if p["outcome"] == "PENDING"]
check("Tous les points sont renseignés", len(restants) == 0,
      f"{len(restants)} en attente sur {len(c['items'])}")

print("\n=== D. RENSEIGNER N'EST PAS VALIDER ===")
st, m = sync(agent, op_id, "CHECK_VALIDATED", {"checkId": c["id"], "remotely": True})
check("L'agent ne peut pas valider sa propre checklist", st == "REJECTED",
      m[:150] or "la séparation des tâches est le cœur du verrou HSE")

st, m = sync(controleur, op_id, "CHECK_VALIDATED", {"checkId": c["id"], "remotely": True})
check("Le contrôleur HSE valide, à distance", st == "ACCEPTED",
      m[:150] or "validation sur pièces — le mode NORMAL (§ 7.2)")

# Relu par l'AGENT : une fois la checklist validée, l'opération sort du
# périmètre du contrôleur — elle ne lui est pas affectée, et il n'a plus rien
# à y valider. C'est le cloisonnement qui se referme, pas une anomalie.
s, checks = call("GET", f"/api/field/hse/operations/{op_id}/checks", agent)
c = next(x for x in checks if x["phase"] == "PRE_DEPARTURE")
check("La validation est inscrite", c.get("validatedAt") is not None,
      f"validée le {str(c.get('validatedAt'))[:19]}")

print("\n=== E. RELEVÉ DE VOLUME ===")
# ⚠️ Le contrat a changé : on relève des volumes OBSERVÉS et leurs
#    températures, le serveur les ramène à 15 °C (ASTM D1250, § 8.2). Les
#    anciens champs « à 15 °C » n'existent plus — ils laissaient la dilatation
#    du produit se compter comme une perte.
st, m = sync(agent, op_id, "MEASUREMENT_RECORDED", {
    "source": "CONTRADICTORY", "measurementDate": datetime.now(timezone.utc).date().isoformat(),
    "uom": "L", "measuredDensity15": 0.832,
    "loadedObservedVolume": 28000, "loadedTempC": 31.2,
    "dischargedObservedVolume": 27960, "dischargedTempC": 29.4})
check("Le relevé est enregistré", st == "ACCEPTED", m[:150] or "28 000 à 31,2 °C · 27 960 à 29,4 °C")

auteur = psql(f"select case when entered_by_field_user_id is not null then 'terrain' "
              f"else 'interne' end from measurement_records where operation_id='{op_id}' limit 1;").strip()
check("Il est attribué au réalm TERRAIN", auteur == "terrain",
      f"auteur : {auteur} — les deux réalms sont deux tables, jamais l'une pour l'autre")

print("\n=== F. AVANCEMENT ===")
st, m = sync(agent, op_id, "STATUS_ADVANCED", {"to": "SOURCING", "reason": "Sourcing engagé"})
check("L'opération avance", st == "ACCEPTED", m[:150] or "vers SOURCING")

acteur = psql(f"select actor_type from operation_status_transitions "
              f"where operation_id='{op_id}' order by created_at desc limit 1;").strip()
check("La transition porte le bon type d'acteur", acteur == "FIELD_USER",
      f"acteur : {acteur}")

print("\n=== G. LE JOURNAL A TOUT GARDÉ ===")
n = psql(f"select count(*) from field_sync_events where operation_id='{op_id}';").strip()
refus = psql(f"select count(*) from field_sync_events where operation_id='{op_id}' "
             f"and status='REJECTED';").strip()
check("Chaque geste est au journal", int(n) >= 8, f"{n} événement(s), dont {refus} refusé(s)")

check("Le refus de validation y est conservé", int(refus) >= 1,
      "le journal garde qu'une validation a été tentée hors des règles")

print("\n" + "=" * 74)
print(f"  {OK}/{OK + FAIL} cas conformes")
print("=" * 74)
