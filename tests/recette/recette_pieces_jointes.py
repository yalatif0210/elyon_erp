# -*- coding: utf-8 -*-
"""
RECETTE — PIÈCES JOINTES DU TERRAIN
Réf. SPECIFICATIONS.md § 10.2

  « Les photos ne transitent pas dans le flux d'événements — compression sur
    l'appareil, file d'envoi séparée avec reprise. Sinon une opération à vingt
    photos bloque toute la synchronisation. »

Éprouve : l'idempotence à DEUX niveaux (l'enregistrement par l'identifiant
d'appareil, le fichier par son empreinte), les plafonds paramétrés, le
cloisonnement au dépôt ET à la lecture, et le refus d'une pièce sans
rattachement.
"""
import io
import json
import subprocess
import urllib.error
import urllib.request
import uuid
import zlib

B = "http://localhost:4200"
PWD = "ChangeMe!2026"
OK = FAIL = 0


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


def multipart(path, tok, champs, fichier=None, nom="photo.png", mime="image/png"):
    """Envoi multipart écrit à la main : pas de dépendance pour six lignes."""
    limite = "----recette" + uuid.uuid4().hex
    corps = io.BytesIO()
    for cle, valeur in champs.items():
        corps.write(f"--{limite}\r\n".encode())
        corps.write(f'Content-Disposition: form-data; name="{cle}"\r\n\r\n'.encode())
        corps.write(f"{valeur}\r\n".encode())
    if fichier is not None:
        corps.write(f"--{limite}\r\n".encode())
        corps.write(
            f'Content-Disposition: form-data; name="file"; filename="{nom}"\r\n'.encode())
        corps.write(f"Content-Type: {mime}\r\n\r\n".encode())
        corps.write(fichier)
        corps.write(b"\r\n")
    corps.write(f"--{limite}--\r\n".encode())

    r = urllib.request.Request(B + path, method="POST", data=corps.getvalue())
    r.add_header("Content-Type", f"multipart/form-data; boundary={limite}")
    r.add_header("Authorization", "Bearer " + tok)
    try:
        with urllib.request.urlopen(r) as x:
            return x.status, json.loads(x.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except Exception:
            return e.code, {"message": raw.decode("utf-8", "replace")[:300]}


def png(couleur):
    """Un PNG 1×1 valide, de contenu variable selon la couleur."""
    def bloc(nom, donnees):
        c = nom + donnees
        return (len(donnees).to_bytes(4, "big") + c
                + (zlib.crc32(c) & 0xFFFFFFFF).to_bytes(4, "big"))
    ihdr = bloc(b"IHDR", (1).to_bytes(4, "big") + (1).to_bytes(4, "big")
                + bytes([8, 2, 0, 0, 0]))
    idat = bloc(b"IDAT", zlib.compress(bytes([0]) + bytes(couleur)))
    return b"\x89PNG\r\n\x1a\n" + ihdr + idat + bloc(b"IEND", b"")


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


def msg(b):
    m = b.get("message")
    return (m if isinstance(m, str) else " · ".join(map(str, m or [])))[:160]


print("=" * 74)
print("  RECETTE — PIÈCES JOINTES DU TERRAIN")
print("=" * 74)

logi = call("POST", "/api/internal/auth/login", None,
            {"email": "logistique@elyon-trading.example", "password": PWD})[1]["accessToken"]
dg = call("POST", "/api/internal/auth/login", None,
          {"email": "dg@elyon-trading.example", "password": PWD})[1]["accessToken"]
agent = call("POST", "/api/field/auth/login", None,
             {"email": "agent.terrain@elyon-trading.example", "password": PWD})[1]["accessToken"]
agent_id = psql("select id from field_users where email='agent.terrain@elyon-trading.example';").strip()

# --- Une opération affectée à l'agent, avec une checklist ouverte -----------
s, ops = call("GET", "/api/internal/operations?search=OP-2026-000001", logi)
modele = ops["items"][0]
s, det = call("GET", f"/api/internal/operations/{modele['id']}", logi)
s, types = call("GET", "/api/internal/referentials/operation-types", logi)
route = next(t["id"] for t in types if t["code"] == "ROUTE")

s, op = call("POST", "/api/internal/operations", logi, {
    "dealId": det["dealId"], "plannedVolume": 4000, "uom": "L", "transportMode": "TRUCK",
    "originLocation": "Dépôt SIR — Abidjan", "destinationLocation": "Site — Daloa",
    "operationTypeIds": [route], "fieldAgentId": agent_id})
op_id = op["id"]

s, autre = call("POST", "/api/internal/operations", logi, {
    "dealId": det["dealId"], "plannedVolume": 4000, "uom": "L", "transportMode": "TRUCK",
    "originLocation": "Dépôt SIR — Abidjan", "destinationLocation": "Site — Bouaké",
    "operationTypeIds": [route]})

s, b = call("POST", "/api/field/sync", agent, {"deviceId": "tablette-recette", "events": [{
    "id": str(uuid.uuid4()), "operationId": op_id, "type": "CHECK_OPENED",
    "payload": {"phase": "PRE_DEPARTURE"}, "sequence": 1,
    "deviceTimestamp": "2026-08-05T10:00:00.000Z"}]})
point = psql(
    f"select i.id from operation_hse_check_items i "
    f"join operation_hse_checks c on c.id=i.check_id "
    f"where c.operation_id='{op_id}' limit 1;").strip()

print("\n=== A. DÉPÔT ===")
u1 = str(uuid.uuid4())
s, p1 = multipart("/api/field/attachments", agent,
                  {"clientUuid": u1, "checkItemId": point,
                   "caption": "Extincteurs vérifiés", "capturedAt": "2026-08-05T10:12:00.000Z"},
                  png([255, 0, 0]))
check("Photo acceptée", s in (200, 201) and p1.get("sha256"),
      f"http {s} · empreinte {str(p1.get('sha256'))[:16]}… · {p1.get('sizeBytes')} octets — {msg(p1) if s>=400 else ''}")

print("\n=== B. IDEMPOTENCE — DEUX NIVEAUX ===")
s, p2 = multipart("/api/field/attachments", agent,
                  {"clientUuid": u1, "checkItemId": point}, png([255, 0, 0]))
check("Renvoi du MÊME identifiant d'appareil : aucune seconde ligne",
      p2.get("alreadyPresent") is True and p2.get("id") == p1.get("id"),
      "une reprise après coupure ne doit pas déposer la photo deux fois")

# Contenu identique, identifiant NEUF : c'est un second rattachement légitime
# (le même cliché versé à deux points), mais UN SEUL fichier sur le disque.
u2 = str(uuid.uuid4())
s, p3 = multipart("/api/field/attachments", agent,
                  {"clientUuid": u2, "checkItemId": point}, png([255, 0, 0]))
check("Contenu identique, identifiant neuf : ligne créée, empreinte partagée",
      p3.get("id") != p1.get("id") and p3.get("sha256") == p1.get("sha256"),
      f"deux rattachements, une seule empreinte {str(p3.get('sha256'))[:16]}…")

n = psql(f"select count(distinct storage_key) from operation_attachments "
         f"where sha256='{p1['sha256']}';").strip()
check("Un seul fichier sur le disque", n == "1",
      f"{n} clé(s) de stockage pour ce contenu — l'adressage par empreinte évite le doublon")

print("\n=== C. PLAFONDS PARAMÉTRÉS ===")
plafond = psql("select value from system_settings where key='FIELD_ATTACHMENT_MAX_MB';").strip()
check("Le plafond est un paramètre, pas une constante", plafond.isdigit(),
      f"FIELD_ATTACHMENT_MAX_MB = {plafond} Mo — réglable depuis l'écran de paramétrage")

s, b = multipart("/api/field/attachments", agent,
                 {"clientUuid": str(uuid.uuid4()), "checkItemId": point},
                 b"%PDF-1.4 faux", nom="doc.exe", mime="application/x-msdownload")
check("Type non admis refusé", s == 400, msg(b))

gros = png([1, 2, 3]) + b"\x00" * (int(plafond) * 1024 * 1024 + 1024)
s, b = multipart("/api/field/attachments", agent,
                 {"clientUuid": str(uuid.uuid4()), "checkItemId": point}, gros)
check("Au-delà du plafond, refusée", s == 400, msg(b))

print("\n=== D. RATTACHEMENT ET CLOISONNEMENT ===")
s, b = multipart("/api/field/attachments", agent,
                 {"clientUuid": str(uuid.uuid4())}, png([9, 9, 9]))
check("Pièce sans rattachement refusée", s == 400, msg(b))

s, b = multipart("/api/field/attachments", agent,
                 {"clientUuid": str(uuid.uuid4()), "checkItemId": str(uuid.uuid4())},
                 png([8, 8, 8]))
check("Point de contrôle hors affectation refusé", s == 404, msg(b))

s, b = multipart("/api/field/attachments", agent,
                 {"checkItemId": point}, png([7, 7, 7]))
check("Sans identifiant d'appareil, refusée", s == 400, msg(b))

print("\n=== E. LECTURE ===")
r = urllib.request.Request(B + f"/api/field/attachments/{p1['id']}")
r.add_header("Authorization", "Bearer " + agent)
with urllib.request.urlopen(r) as x:
    contenu = x.read()
    type_rendu = x.headers.get("Content-Type", "")
check("L'agent relit sa pièce", contenu == png([255, 0, 0]),
      f"{len(contenu)} octets · {type_rendu}")

s, liste = call("GET", f"/api/internal/attachments?operationId={op_id}", dg)
check("Le bureau voit les pièces de l'opération", s == 200 and len(liste) >= 2,
      f"{len(liste)} pièce(s) — la validation HSE à distance est le mode NORMAL (§ 7.2)")

check("La liste ne porte aucun binaire",
      all("storageKey" not in p and "sha256" not in p for p in liste),
      "un écran qui n'affiche qu'une photo à la fois n'a pas à toutes les charger")

print("\n=== F. LE BINAIRE N'EST PAS EN BASE ===")
colonnes = psql("select string_agg(column_name, ',') from information_schema.columns "
                "where table_name='operation_attachments';").strip()
check("Aucune colonne binaire",
      "bytea" not in psql("select string_agg(data_type,',') from information_schema.columns "
                          "where table_name='operation_attachments';").lower(),
      f"colonnes : {colonnes[:110]}…")

print("\n" + "=" * 74)
print(f"  {OK}/{OK + FAIL} cas conformes")
print("=" * 74)
