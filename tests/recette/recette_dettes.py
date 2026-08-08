"""
RECETTE — RÈGLEMENT DES DETTES D'IMPLÉMENTATION

A. Changement de mot de passe   (le bandeau exigeait une action inexistante)
B. Enrôlement du second facteur
C. Paramétrage des référentiels — saisie unitaire
D. Import de fichier avec rapport de rejet ligne à ligne
E. Non-régression des lots 1 et 2
"""
import json, urllib.request, urllib.error
from uuid import uuid4

B = "http://localhost:4200"
PWD = "ChangeMe!2026"
RUN = uuid4().hex[:6].upper()
# Les contraintes d unicite du produit sont reelles : chaque passage doit
# ecrire sur des cles neuves, sinon le rejeu heurte le produit a tort.
AN = 2030 + (int(RUN, 16) % 40)
# La date de recette est tirée au JOUR près, pas seulement à l'année : une
# donnée historisée ne se réécrit pas, et deux campagnes tombant sur la même
# date verraient la seconde refusée — un échec qui n'apprend rien sur le code,
# seulement sur le résidu laissé par la précédente. Ces lignes lointaines sont
# balayées par la purge de prisma/sql/10_types_operation.sql.
JOUR = 1 + (int(RUN, 16) % 28)
MOIS = 1 + (int(RUN, 16) // 28 % 11)   # 1..11 : MOIS+1 reste dans l'année
DATE1 = f"{AN}-{MOIS:02d}-{JOUR:02d}"          # ISO, pour les seuils
DATE2 = f"{AN}-{MOIS + 1:02d}-{JOUR:02d}"      # postérieure : elle clôt la première
results = []


def call(m, p, t=None, b=None):
    r = urllib.request.Request(B + p, method=m)
    r.add_header("Content-Type", "application/json")
    if t:
        r.add_header("Authorization", "Bearer " + t)
    try:
        with urllib.request.urlopen(r, json.dumps(b).encode() if b is not None else None) as x:
            body = x.read().decode()
            return x.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "{}")
        except Exception:
            return e.code, {"raw": raw}


def login(realm, email, pwd=PWD):
    s, b = call("POST", f"/api/{realm}/auth/login", b={"email": email, "password": pwd})
    assert s == 200, (email, s, b)
    return b


def check(label, ok, detail=""):
    results.append((ok, label, detail))
    print(("  OK    " if ok else "  ECHEC ") + label + (f"\n          {detail}" if detail else ""))


def msg(b):
    m = b.get("message", b)
    return (m if isinstance(m, str) else json.dumps(m, ensure_ascii=False))[:150]


dg = login("internal", "dg@elyon-trading.example")["accessToken"]
cfo = login("internal", "cfo@elyon-trading.example")["accessToken"]
logi = login("internal", "logistique@elyon-trading.example")["accessToken"]

print("\n=== A. CHANGEMENT DE MOT DE PASSE ===")
EMAIL = "assistante@elyon-trading.example"
# Le drapeau provisoire est repose avant chaque passage : le test le consomme.
import subprocess
subprocess.run(["docker","compose","exec","-T","postgres","sh","-c",
  "psql -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -tAc \"UPDATE users SET must_change_password=true WHERE email='"+EMAIL+"'\""],
  capture_output=True)
me = login("internal", EMAIL)
tok = me["accessToken"]
check("Compte marqué mot de passe provisoire", me["mustChangePassword"] is True)

s, b = call("PATCH", "/api/internal/auth/password", tok,
            {"currentPassword": "MauvaisMotDePasse", "newPassword": "phrase de passe suffisante"})
check("Mot de passe actuel faux refusé", s == 401, msg(b))

s, b = call("PATCH", "/api/internal/auth/password", tok,
            {"currentPassword": PWD, "newPassword": "trop court"})
check("Moins de 12 caractères refusé", s == 400, msg(b))

s, b = call("PATCH", "/api/internal/auth/password", tok,
            {"currentPassword": PWD, "newPassword": PWD})
check("Nouveau identique à l'actuel refusé", s == 400, msg(b))

autre = login("internal", EMAIL)["accessToken"]
s, b = call("PATCH", "/api/internal/auth/password", tok,
            {"currentPassword": PWD, "newPassword": "phrase de passe suffisante"})
check("Changement accepté", s == 200, f"{b.get('revokedSessions')} autre(s) session(s) fermée(s)")
check("Session courante épargnée", call("GET", "/api/internal/auth/me", tok)[0] == 200)
check("Autres sessions révoquées", call("GET", "/api/internal/auth/me", autre)[0] == 401)

apres = login("internal", EMAIL, "phrase de passe suffisante")
check("Obligation de changement levée", apres["mustChangePassword"] is False)
check("Ancien mot de passe refusé",
      call("POST", "/api/internal/auth/login", b={"email": EMAIL, "password": PWD})[0] == 401)

# Remise en état du jeu de démonstration.
call("PATCH", "/api/internal/auth/password", apres["accessToken"],
     {"currentPassword": "phrase de passe suffisante", "newPassword": PWD})

print("\n=== B. SECOND FACTEUR ===")
s, b = call("POST", "/api/internal/auth/totp/enroll", dg, {})
check("Secret d'enrôlement délivré", s == 200 and len(b.get("secret", "")) >= 16,
      f"{len(b.get('secret',''))} caractères · clé d'URI fournie : {'otpauthUrl' in b}")
s, b = call("POST", "/api/internal/auth/totp/confirm", dg, {"code": "000000"})
check("Code invalide refusé — le facteur reste inactif", s in (400, 401), msg(b))

print("\n=== C. PARAMÉTRAGE — SAISIE UNITAIRE ===")
s, cat = call("GET", "/api/internal/parameters", dg)
check("Catalogue des tables administrables", s == 200 and len(cat) >= 8, f"{len(cat)} tables")

s, b = call("POST", "/api/internal/parameters/products", logi, {
    "values": {"code": f"P{RUN}", "name": "Produit de recette",
               "referenceDensity15": "0,795", "defaultUom": "L", "uiColorToken": "cyan-400"}})
check("Création, décimale à la virgule acceptée", s == 201, f"http {s} — {msg(b)}")

s, b = call("POST", "/api/internal/parameters/products", logi, {
    "values": {"code": f"P{RUN}", "name": "Produit corrigé",
               "referenceDensity15": "0,800", "defaultUom": "L", "uiColorToken": "cyan-400"}})
check("Table mutable : correction sur place", s == 201 and b.get("created") is False,
      f"créé={b.get('created')}")

s, b = call("POST", "/api/internal/parameters/products", logi, {
    "values": {"code": f"X{RUN}", "name": "x", "referenceDensity15": "abc", "defaultUom": "ZZZ"}})
errs = b.get("errors", [])
check("Erreurs CUMULÉES, pas seulement la première", s == 400 and len(errs) >= 3,
      f"{len(errs)} erreurs : " + " · ".join(e["message"][:52] for e in errs[:3]))

s, b = call("POST", "/api/internal/parameters/margin-thresholds", logi, {
    "values": {"segment": "B2B", "currencyCode": "XOF", "uom": "L", "directFloor": "5",
               "effectiveFrom": DATE1}, "reason": "tentative"})
check("Habilitation portée par le référentiel", s == 403, msg(b))

print("\n=== Historisation ===")
s, b = call("POST", "/api/internal/parameters/margin-thresholds", dg, {
    "values": {"segment": "RETAIL", "currencyCode": "XOF", "uom": "L",
               "directFloor": "8", "minimumMargin": "25", "effectiveFrom": DATE1}})
check("Motif exigé sur donnée historisée", s == 400, msg(b))

s, b = call("POST", "/api/internal/parameters/margin-thresholds", dg, {
    "values": {"segment": "RETAIL", "currencyCode": "XOF", "uom": "L",
               "directFloor": "8", "minimumMargin": "25", "effectiveFrom": DATE1},
    "reason": "Grille approuvée en conseil"})
check("Version datée créée", s == 201, f"http {s}")

s, b = call("POST", "/api/internal/parameters/margin-thresholds", dg, {
    "values": {"segment": "RETAIL", "currencyCode": "XOF", "uom": "L", "directFloor": "99",
               "effectiveFrom": DATE1}, "reason": "Tentative de réécriture"})
check("Réécriture d'une ligne historisée refusée", s == 400, msg(b))

s, b = call("POST", "/api/internal/parameters/margin-thresholds", dg, {
    "values": {"segment": "RETAIL", "currencyCode": "XOF", "uom": "L",
               "directFloor": "9", "minimumMargin": "28", "effectiveFrom": DATE2},
    "reason": "Revalorisation du second semestre"})
check("Nouvelle version à une autre date", s == 201, f"http {s}")

s, grid = call("GET", "/api/internal/referentials/margin-thresholds", dg)
retail = [g for g in grid if g.get("segment") == "RETAIL" and str(g.get("effectiveFrom", "")).startswith(DATE1)]
closed = [g for g in retail if g.get("effectiveTo")]
check("Version antérieure CLOSE, sans recouvrement", len(closed) >= 1,
      f"close au {str(closed[0]['effectiveTo'])[:10] if closed else '—'}")

print("\n=== D. IMPORT DE FICHIER ===")
s, tpl = call("GET", "/api/internal/parameters/products/template", dg)
check("Gabarit d'import fourni", s == 200 and len(tpl.get("colonnes", [])) > 0,
      f"{len(tpl.get('colonnes', []))} colonnes")

rows = [
    {"code": f"I{RUN}A", "name": "Import valide 1", "referenceDensity15": "0,820",
     "defaultUom": "L", "uiColorToken": "violet-400"},
    {"code": f"I{RUN}B", "name": "Densité illisible", "referenceDensity15": "beaucoup",
     "defaultUom": "L", "uiColorToken": "violet-400"},
    {"code": f"I{RUN}C", "name": "Unité inconnue", "referenceDensity15": "0,830",
     "defaultUom": "TONNEAU", "uiColorToken": "violet-400"},
    {"code": f"I{RUN}D", "name": "Import valide 2", "referenceDensity15": "0,845",
     "defaultUom": "MT", "uiColorToken": "amber-400", "colonneInconnue": "x"},
    {"code": "", "name": "Sans code", "referenceDensity15": "0,8", "defaultUom": "L",
     "uiColorToken": "emerald-400"},
    {"code": f"I{RUN}E", "name": "Densite impossible", "referenceDensity15": "3,5",
     "defaultUom": "L", "uiColorToken": "emerald-400"},
]

s, rep = call("POST", "/api/internal/parameters/products/import", logi, {"rows": rows, "dryRun": True})
check("Simulation : rien n'est écrit", s == 201 and rep.get("simulation") is True,
      f"{rep.get('lues')} lues · {rep.get('rejetees')} rejetées")

s, rep = call("POST", "/api/internal/parameters/products/import", logi, {"rows": rows})
check("Les lignes valides passent malgré les fautives",
      s == 201 and rep.get("creees") == 2 and rep.get("rejetees") == 4,
      f"{rep.get('creees')} créées · {rep.get('rejetees')} rejetées sur {rep.get('lues')}")

lignes = sorted({r["line"] for r in rep.get("rejets", [])})
check("Rejets numérotés comme dans le tableur", lignes == [3, 4, 6, 7],
      f"lignes {lignes} — l'entête occupe la ligne 1")
for r in rep.get("rejets", [])[:3]:
    print(f"          ligne {r['line']} · {r.get('field') or '—'} · {r['message'][:78]}")

check("Colonne inconnue signalée sans bloquer", len(rep.get("avertissements", [])) >= 1,
      rep.get("avertissements", [{}])[0].get("message", "")[:78])

s, b = call("POST", "/api/internal/parameters/fx-rates/import", cfo, {
    "rows": [{"baseCurrencyCode": "USD", "quoteCurrencyCode": "XOF", "rate": "612,40",
              "rateType": "OFFICIAL", "effectiveFrom": f"{JOUR:02d}/{MOIS:02d}/{AN}"}],
    "reason": "Cours BCEAO de septembre"})
check("Date jour/mois/année et virgule décimale acceptées",
      s == 201 and b.get("creees") == 1, f"{b.get('creees')} créée(s) · {b.get('rejetees')} rejetée(s)")

s, b = call("POST", "/api/internal/parameters/fx-rates/import", cfo, {
    "rows": [{"baseCurrencyCode": "USD", "quoteCurrencyCode": "XOF", "rate": "1",
              "rateType": "OFFICIAL", "effectiveFrom": f"{JOUR:02d}/{MOIS + 1:02d}/{AN}"}]})
check("Import historisé sans motif refusé", s == 400, msg(b))

print("\n=== E. NON-RÉGRESSION ===")
for label, route, tok_ in [
    ("Affaires et chaîne de marge", "/api/internal/deals?pageSize=1", dg),
    ("Opérations", "/api/internal/operations?pageSize=1", logi),
    ("Facturation", "/api/internal/invoices?pageSize=1", cfo),
    ("Achats et prépaiements", "/api/internal/supplier-invoices?pageSize=1", cfo),
    ("Documents", "/api/internal/documents?pageSize=1", dg),
    ("Conformité", "/api/internal/compliance/overview", dg),
    ("Avances non apurées", "/api/internal/supervision/outstanding-prepayments", cfo),
]:
    st, _ = call("GET", route, tok_)
    check(label, st == 200, f"http {st}")

s, d = call("GET", "/api/internal/deals?search=DEAL-2026-08-001", dg)
did = d["items"][0]["id"]
s, deal = call("GET", f"/api/internal/deals/{did}", dg)
m = deal["margin"]
check("Marge inchangée", abs(m["directMargin"] - 55.28) < 0.01 and abs(m["fullMargin"] - 38.28) < 0.01,
      f"directe {m['directMargin']} · complète {m['fullMargin']}")

ok = sum(1 for r in results if r[0])
print(f"\n{'=' * 74}\n  {ok}/{len(results)} cas conformes\n{'=' * 74}")
for r in results:
    if not r[0]:
        print(f"  ECHEC : {r[1]}\n          {r[2]}")
