# -*- coding: utf-8 -*-
"""
RECETTE — JOURNAL D'ÉVÉNEMENTS TERRAIN
Réf. SPECIFICATIONS.md § 10.2

Éprouve ce qui fait la valeur du dispositif, et qui ne se voit qu'en le
maltraitant :
  - un renvoi après coupure ne duplique RIEN ;
  - l'ordre de PRODUCTION fait foi, pas l'ordre d'arrivée ;
  - un refus suspend la suite de SON opération, et d'elle seule ;
  - une opération qui n'est pas la vôtre est refusée sans rien révéler ;
  - le journal ne se réécrit ni ne s'efface, même pour l'application.
"""
import json
import subprocess
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

B = "http://localhost:4200"
PWD = "ChangeMe!2026"
OK = FAIL = 0
APPAREIL = f"tablette-recette-{uuid.uuid4().hex[:8]}"


def call(method, path, tok=None, body=None):
    r = urllib.request.Request(B + path, method=method)
    r.add_header("Content-Type", "application/json")
    if tok:
        r.add_header("Authorization", "Bearer " + tok)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(r, data) as x:
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


def psql(sql):
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "erp_migrator",
         "-d", "erp", "-t", "-A", "-c", sql],
        cwd=r"c:\Users\DEBORA\Downloads\ELYON TRADING\erp",
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (out.stdout or "") + (out.stderr or "")


def ev(op, type_, payload, seq, minutes_ago=0):
    """Un événement tel que la tablette le produit — avec SON identifiant."""
    return {
        "id": str(uuid.uuid4()),
        "operationId": op,
        "type": type_,
        "payload": payload,
        "sequence": seq,
        "deviceTimestamp": (datetime.now(timezone.utc)
                            - timedelta(minutes=minutes_ago)).isoformat(),
    }


print("=" * 74)
print("  RECETTE — JOURNAL D'ÉVÉNEMENTS TERRAIN")
print("=" * 74)

logi = call("POST", "/api/internal/auth/login", None,
            {"email": "logistique@elyon-trading.example", "password": PWD})[1]["accessToken"]
s, moi = call("POST", "/api/field/auth/login", None,
              {"email": "agent.terrain@elyon-trading.example", "password": PWD})
agent = moi["accessToken"]
agent_id = psql("select id from field_users where email='agent.terrain@elyon-trading.example';").strip()

# --- Deux opérations affectées à l'agent, pour éprouver le cloisonnement ----
s, ops = call("GET", "/api/internal/operations?search=OP-2026-000001", logi)
modele = ops["items"][0]
s, det = call("GET", f"/api/internal/operations/{modele['id']}", logi)
s, types = call("GET", "/api/internal/referentials/operation-types", logi)
route = next(t["id"] for t in types if t["code"] == "ROUTE")

def cree(destination, avec_agent=True):
    corps = {"dealId": det["dealId"], "plannedVolume": 3000, "uom": "L",
             "transportMode": "TRUCK", "originLocation": "Dépôt SIR — Abidjan",
             "destinationLocation": destination, "operationTypeIds": [route]}
    if avec_agent:
        corps["fieldAgentId"] = agent_id
    st, b = call("POST", "/api/internal/operations", logi, corps)
    if st not in (200, 201):
        raise SystemExit(f"Création impossible ({st}) : {b}")
    return b["id"]

op_a = cree("Site A — Man")
op_b = cree("Site B — Korhogo")
op_autrui = cree("Site C — San Pedro", avec_agent=False)

print("\n=== A. REMONTÉE NORMALE ===")
lot1 = [ev(op_a, "CHECK_OPENED", {"phase": "PREPARATION"}, 1, 90)]
s, rep = call("POST", "/api/field/sync", agent, {"deviceId": APPAREIL, "events": lot1})
check("Lot accepté", s in (200, 201) and rep.get("accepted") == 1,
      f"http {s} · {rep.get('accepted')} accepté(s) · {json.dumps(rep.get('outcomes'), ensure_ascii=False)[:150]}")

print("\n=== B. IDEMPOTENCE — LE CŒUR DU DISPOSITIF ===")
s, rep2 = call("POST", "/api/field/sync", agent, {"deviceId": APPAREIL, "events": lot1})
check("Le renvoi ne duplique rien",
      s in (200, 201) and rep2.get("alreadyKnown") == 1 and rep2.get("accepted") == 0,
      f"{rep2.get('alreadyKnown')} déjà connu(s) · {rep2.get('accepted')} appliqué(s) — "
      "une coupure après application produirait sinon deux checklists")

n = psql(f"select count(*) from operation_hse_checks where operation_id='{op_a}';").strip()
check("Une seule checklist en base", n == "1", f"{n} checklist(s) après deux envois identiques")

print("\n=== C. L'ORDRE DE PRODUCTION FAIT FOI ===")
# Volontairement transmis À L'ENVERS : le serveur doit les remettre dans l'ordre.
points = psql(
    f"select i.id from operation_hse_check_items i "
    f"join operation_hse_checks c on c.id = i.check_id "
    f"where c.operation_id='{op_a}' order by i.created_at limit 2;").split()
lot2 = [
    ev(op_a, "CHECK_ITEM_RECORDED",
       {"checkItemId": points[1], "outcome": "PASSED"}, 3, 40),
    ev(op_a, "CHECK_ITEM_RECORDED",
       {"checkItemId": points[0], "outcome": "PASSED"}, 2, 50),
]
s, rep = call("POST", "/api/field/sync", agent, {"deviceId": APPAREIL, "events": lot2})
ordre = psql(
    f"select string_agg(sequence::text, ',' order by received_at) "
    f"from field_sync_events where operation_id='{op_a}' and sequence in (2,3);").strip()
check("Rejoué dans l'ordre du journal de l'appareil", ordre == "2,3",
      f"rangs traités : {ordre} — reçus dans l'ordre 3 puis 2")

print("\n=== D. OPÉRATION D'AUTRUI ===")
s, rep = call("POST", "/api/field/sync", agent, {
    "deviceId": APPAREIL,
    "events": [ev(op_autrui, "CHECK_OPENED", {"phase": "PREPARATION"}, 1)]})
motif = (rep.get("outcomes") or [{}])[0].get("reason", "")
check("Refusée", rep.get("rejected") == 1, motif[:110])
check("Sans révéler que l'opération existe",
      "affectation" in motif.lower() and "existe pas" not in motif.lower(),
      "distinguer « inconnue » de « pas la vôtre » dirait qu'un client est servi ce jour-là")

print("\n=== E. UN REFUS SUSPEND SON OPÉRATION, PAS LES AUTRES ===")
lot3 = [
    # Refusé : la phase de clôture n'a aucun point tant que rien n'est fait.
    ev(op_a, "CHECK_ITEM_RECORDED", {"checkItemId": str(uuid.uuid4()), "outcome": "PASSED"}, 10),
    # Même opération, APRÈS le refus : suspendu, pas perdu.
    ev(op_a, "STATUS_ADVANCED", {"to": "SOURCING"}, 11),
    # Autre opération : sans rapport, elle doit passer.
    ev(op_b, "CHECK_OPENED", {"phase": "PREPARATION"}, 1),
]
s, rep = call("POST", "/api/field/sync", agent, {"deviceId": APPAREIL, "events": lot3})
par_id = {o["id"]: o for o in rep.get("outcomes", [])}
check("L'événement fautif est refusé, avec un motif exploitable",
      par_id[lot3[0]["id"]]["status"] == "REJECTED",
      par_id[lot3[0]["id"]].get("reason", "")[:110])
check("Le suivant de la MÊME opération est suspendu",
      par_id[lot3[1]["id"]]["status"] == "DEFERRED",
      "il décrit la suite d'un déroulé dont une étape vient d'être refusée")
check("L'AUTRE opération passe", par_id[lot3[2]["id"]]["status"] == "ACCEPTED",
      "un refus ne doit pas suspendre une opération sans rapport")

print("\n=== E bis. CHARGE UTILE FAUTIVE ===")
s, rep = call("POST", "/api/field/sync", agent, {"deviceId": APPAREIL, "events": [
    ev(op_b, "CHECK_ITEM_RECORDED", {"checkItemId": points[0], "outcome": "CONFORME"}, 50)]})
m = (rep.get("outcomes") or [{}])[0].get("reason", "")
check("Valeur hors énumération refusée", rep.get("rejected") == 1, m[:130])
check("Le motif est une consigne, pas une trace interne",
      "prisma" not in m.lower() and "invocation" not in m.lower() and "/app/" not in m,
      "l'agent est seul sur site : un vidage d'appel interne ne lui dit rien à faire")

print("\n=== E ter. CLOISONNEMENT PAR LE POINT DE CONTRÔLE ===")
# Le périmètre est vérifié sur l'OPÉRATION. Un point de contrôle pris ailleurs
# ne doit pas pour autant devenir renseignable : ce serait la porte de derrière.
s, rep = call("POST", "/api/field/sync", agent, {"deviceId": APPAREIL, "events": [
    ev(op_b, "CHECK_ITEM_RECORDED", {"checkItemId": points[0], "outcome": "PASSED"}, 60)]})
m = (rep.get("outcomes") or [{}])[0].get("reason", "")
check("Point d'une AUTRE opération refusé", rep.get("rejected") == 1, m[:120])

print("\n=== F. LE SUSPENDU N'EST PAS PERDU ===")
n = psql(f"select count(*) from field_sync_events where id='{lot3[1]['id']}';").strip()
check("Il n'est PAS journalisé", n == "0",
      "journalisé, son identifiant serait brûlé et le renvoi pris pour un doublon")

s, rep = call("POST", "/api/field/sync", agent, {"deviceId": APPAREIL, "events": [lot3[1]]})
check("Représenté seul, il est traité",
      (rep.get("outcomes") or [{}])[0]["status"] in ("ACCEPTED", "REJECTED"),
      f"{(rep.get('outcomes') or [{}])[0]['status']} — le blocage était celui du lot, pas le sien")

print("\n=== G. UN REFUS EST DÉFINITIF ===")
s, rep = call("POST", "/api/field/sync", agent, {"deviceId": APPAREIL, "events": [lot3[0]]})
check("Le renvoi d'un refusé rend le même refus",
      rep.get("alreadyKnown") == 1 and (rep.get("outcomes") or [{}])[0]["status"] == "REJECTED",
      "résoudre un rejet = lever la cause PUIS produire un événement neuf")

s, rejets = call("GET", "/api/field/sync/rejections", agent)
check("Les refus restent consultables", s == 200 and len(rejets) >= 1,
      f"{len(rejets)} refus — la file de la tablette peut disparaître, pas eux")

print("\n=== H. LE JOURNAL NE SE RÉÉCRIT PAS ===")
r = psql(f"update field_sync_events set status='ACCEPTED' where operation_id='{op_a}';")
check("Réécriture refusée par la base", "ajout seul" in r.lower(), r.strip()[:110])
r = psql(f"delete from field_sync_events where operation_id='{op_a}';")
check("Effacement refusé par la base", "ajout seul" in r.lower(), r.strip()[:110])

print("\n=== I. LES DEUX HORLOGES ===")
d = psql(f"select max(drift_seconds) from v_field_clock_drift "
         f"where operation in (select reference from operations where id='{op_a}');").strip()
check("L'écart entre l'horloge de l'appareil et la réception est mesuré",
      d.isdigit() and int(d) >= 2400,
      f"{d} s — l'événement le plus ancien a été produit 90 min avant l'envoi")

print("\n" + "=" * 74)
print(f"  {OK}/{OK + FAIL} cas conformes")
print("=" * 74)
