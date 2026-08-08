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
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://localhost:4200"

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
    ("recette_audit", "Correctifs issus de l'audit"),
]


def pile_repond() -> bool:
    try:
        with urllib.request.urlopen(BASE + "/health", timeout=5) as r:
            return r.status == 200
    except (urllib.error.URLError, urllib.error.HTTPError, OSError):
        return False


def main() -> int:
    if not pile_repond():
        print(f"✗ La pile ne repond pas sur {BASE}.")
        print("  Lancer d'abord : docker compose up -d")
        return 1

    racine = Path(__file__).parent
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

        r = subprocess.run(
            [sys.executable, str(fichier)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"},
        )
        sortie = (r.stdout or "") + (r.stderr or "")
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
            print("            " + sortie.strip().splitlines()[-1][:150] if sortie.strip() else "")

    print("=" * 72)
    print(f"  {total_ok}/{total_cas} cas conformes sur {len(SUITES)} suites")
    if echecs:
        print("  Suites en echec : " + ", ".join(echecs))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
