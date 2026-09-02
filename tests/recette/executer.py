# -*- coding: utf-8 -*-
"""
LANCEUR DE LA RECETTE COMPLETE.

    python tests/recette/executer.py

Pourquoi ce fichier existe
--------------------------
L'audit du 8 aout 2026 a constate que les suites de recette vivaient dans un
repertoire TEMPORAIRE, hors du depot : 181 cas passaient, et un developpeur
clonant le projet n'avait aucun moyen de savoir qu'ils existaient. Le ratio
code/tests du depot valait donc zero, quoi qu'en dise le tableau de bord.

Une recette qui n'est ni versionnee ni rejouable documente un instant ; elle ne
protege pas les evolutions.

Prerequis : la pile doit tourner (docker compose up -d) et repondre sur
http://localhost:4200.

Sortie : code 0 si tous les cas passent, 1 sinon — exploitable en integration
continue sans adaptation.
"""
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://localhost:4200"

# Duree de la fenetre du limiteur de debit sur la connexion, plus une marge.
# Rejouer la recette dans la minute depasse LOGIN_RATE_PER_MINUTE : c'est la
# protection contre le brute force qui joue, pas un defaut.
FENETRE_DEBIT_S = 65

# L'ordre compte : la cloture du lot 2 pose les donnees que les suites
# suivantes lisent. Les suites d'audit viennent en dernier — elles annulent des
# pieces, et le faire plus tot fausserait les cumuls que les autres verifient.
SUITES = [
    ("cloture_lot2", "Cloture du lot 2 — chaine commerciale complete"),
    ("recette_dettes", "Dettes d'implementation soldees"),
    ("recette_types_hse", "Types d'operation et checklists HSE"),
    ("recette_journal_terrain", "Journal terrain — idempotence et rejets"),
    ("recette_pieces_jointes", "Pieces jointes et exigence de preuve"),
    ("recette_parcours_terrain", "Parcours complet de l'agent de terrain"),
    ("recette_budget", "Donnees budgetaires, exercice et pilotage"),
    ("recette_crm", "Pipeline commercial"),
    ("recette_portail", "Portail client — cloisonnement par tiers"),
    ("recette_audit", "Correctifs issus de l'audit"),
]


def pile_repond() -> bool:
    try:
        with urllib.request.urlopen(BASE + "/health", timeout=5) as r:
            return r.status == 200
    except (urllib.error.URLError, urllib.error.HTTPError, OSError):
        return False


def jouer(fichier: Path) -> str:
    """Execute une suite et rend sa sortie complete."""
    r = subprocess.run(
        [sys.executable, str(fichier)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    return (r.stdout or "") + (r.stderr or "")


def remettre_a_zero(racine: Path) -> bool:
    """
    Efface les artefacts de la campagne precedente.

    ⚠️ SANS CETTE ETAPE, LA RECETTE NE PASSE QU'UNE FOIS.

       Les suites creent des exercices, des previsions, des opportunites et des
       pieces de facturation. Au second passage, elles butent sur leurs propres
       traces : « une ligne existe deja », « il ne reste que 25 L a facturer ».
       Une recette qui echoue au second passage finit desactivee, et c'est
       exactement ce que l'audit reprochait a la recette d'avant.
    """
    script = racine / "nettoyage.sql"
    if not script.exists():
        print("  ⚠️  nettoyage.sql absent : la recette peut echouer au second passage.")
        return True

    r = subprocess.run(
        # ⚠️ `-v ON_ERROR_STOP=1` N'EST PAS UN DÉTAIL.
        #
        #    Sans lui, psql poursuit apres une erreur ET REND 0. La remise a
        #    zero echouait donc en silence tout en se declarant reussie — une
        #    instruction fautive au milieu du script laissait la moitie des
        #    artefacts en place, et l'echec se manifestait plus tard, ailleurs,
        #    sous une forme incomprehensible.
        ["docker", "compose", "exec", "-T", "postgres",
         "psql", "-U", "erp_migrator", "-d", "erp", "-q", "-v", "ON_ERROR_STOP=1"],
        input=script.read_text(encoding="utf-8"),
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=str(racine.parent.parent),
    )
    if r.returncode != 0:
        detail = (r.stderr or "").strip()[:300]
        # ASCII strict : la console Windows est en cp1252, et un accent
        # dans le message de PostgreSQL faisait planter l'affichage de
        # l'erreur — on perdait le diagnostic au moment ou il servait.
        print("  /!\\ Remise a zero impossible :",
              detail.encode("ascii", "replace").decode("ascii"))
        return False
    return True


def main() -> int:
    if not pile_repond():
        print(f"✗ La pile ne repond pas sur {BASE}.")
        print("  Lancer d'abord : docker compose up -d")
        return 1

    racine = Path(__file__).parent
    remettre_a_zero(racine)
    total_ok = total_cas = 0
    echecs: list[str] = []

    print("RECETTE ELYON TRADING")
    print("=" * 72)

    for module, libelle in SUITES:
        fichier = racine / f"{module}.py"
        if not fichier.exists():
            print(f"  {'MANQUE':>8}  {libelle}")
            echecs.append(f"{module} (fichier absent)")
            continue

        sortie = jouer(fichier)

        # ⚠️ LE LIMITEUR DE DEBIT SUR LA CONNEXION N'EST PAS UN DEFAUT.
        #
        #    Chaque suite ouvre plusieurs sessions ; deux campagnes enchainees
        #    depassent LOGIN_RATE_PER_MINUTE et recoivent des 429. C'est la
        #    protection contre le brute force qui joue son role — la desactiver
        #    pour faire passer les tests reviendrait a tester un systeme qu'on
        #    n'exploitera jamais.
        #
        #    On rejoue une fois APRES la fenetre des que la suite n'a rendu
        #    AUCUN resultat. Le declencheur n'est volontairement pas « 429 dans
        #    la sortie » : le refus se manifeste aussi par un KeyError sur le
        #    jeton absent, ou par un 401 quand le compteur d'echecs a monte.
        #    Une suite qui s'interrompt merite une seconde chance quelle qu'en
        #    soit la cause ; si elle echoue de nouveau, l'echec est reel.
        if "cas conformes" not in sortie:
            print(f"  {'attente':>8}  {libelle:<52} interrompue, seconde tentative")
            remettre_a_zero(racine)
            time.sleep(FENETRE_DEBIT_S)
            sortie = jouer(fichier)

        m = re.search(r"(\d+)/(\d+) cas conformes", sortie)

        if m:
            n, d = int(m.group(1)), int(m.group(2))
            total_ok += n
            total_cas += d
            etat = "ok" if n == d else "ECHEC"
            print(f"  {etat:>8}  {libelle:<52} {n}/{d}")
            if n != d:
                echecs.append(f"{module} ({n}/{d})")
                # Ne montrer que les lignes en echec : le detail complet noierait
                # le resultat, et c'est le resultat qu'on vient lire.
                for ligne in sortie.splitlines():
                    if ligne.strip().startswith("ECHEC"):
                        print(f"            {ligne.strip()}")
        else:
            print(f"  {'ERREUR':>8}  {libelle}")
            echecs.append(f"{module} (pas de resultat lisible)")
            # La derniere ligne porte l'exception : la montrer evite d'avoir a
            # relancer la suite a la main pour savoir ce qui s'est passe.
            lignes = [l for l in sortie.strip().splitlines() if l.strip()]
            if lignes:
                print(f"            {lignes[-1][:150]}")

    print("=" * 72)
    print(f"  {total_ok}/{total_cas} cas conformes sur {len(SUITES)} suites")
    if echecs:
        print("  Suites en echec : " + ", ".join(echecs))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
