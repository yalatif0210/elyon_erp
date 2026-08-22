-- ===========================================================================
--  PARAMÈTRES SYSTÈME — VALEURS PAR DÉFAUT SÛRES, SUR TOUT ENVIRONNEMENT
--  Réf. SPECIFICATIONS.md § 1.1 bis, § 1.4, § 5.4, § 9.5
--
--  ⚠️ CES VINGT-SIX LIGNES NE VIVAIENT QUE DANS LE SEMIS DE DÉMONSTRATION.
--
--     `db:deploy` (staging, production) n'exécute JAMAIS `db:seed` — à dessein,
--     pour ne pas injecter de tiers, sites ou affaires fictifs dans une base
--     réelle (voir DEPLOIEMENT.md § 4). Mais ces vingt-six réglages ne sont PAS
--     des données de démonstration : ce sont des seuils, des durées, des
--     quotas et des règles de sécurité que le système lit réellement
--     (`SettingsService`), avec un repli codé en dur si la ligne manque —
--     jamais un défaut dangereux, mais un défaut que PERSONNE n'a choisi ni ne
--     peut régler depuis l'écran de paramétrage tant que la ligne n'existe
--     pas. Un déploiement de staging ne montrait donc qu'UNE ligne sur
--     vingt-sept : `PROOF_LOCK_INSTALLED_AT`, la seule déjà posée par une
--     migration (§ 12_exigence_photo.sql) plutôt que par le semis.
--
--     Les valeurs ci-dessous sont EXACTEMENT celles du semis de développement
--     (prisma/seed.ts) : des points de départ déjà pensés comme sûrs pour
--     n'importe quel environnement, pas des données propres à un jeu de test.
--     Elles restent modifiables ligne par ligne depuis Paramétrage → bouton
--     « Modifier », comme n'importe quel autre réglage.
--
--  `ON CONFLICT DO NOTHING` : une valeur déjà réglée par un exploitant ne doit
--  jamais être écrasée par ce défaut au fil des migrations suivantes.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

INSERT INTO system_settings (key, value, value_type, description, updated_at)
VALUES
  ('PIVOT_CURRENCY', 'USD', 'string',
   'Devise pivot — dénominateur commun du risque et de la marge consolidée (§ 9.2).',
   now()),
  ('LOCAL_CURRENCY', 'XOF', 'string',
   'Devise légale du pays d''exploitation.',
   now()),
  ('FISCAL_COUNTRY', 'CI', 'string',
   'Pays dont le régime fiscal s''applique aux pièces émises (§ 9.4).',
   now()),
  ('VAT_STANDARD_RATE', '18', 'number',
   'Taux de TVA de droit commun, en pourcentage. À confirmer avec le conseil fiscal pour chaque régime produit.',
   now()),
  ('FINANCING_RATE_ANNUAL_PCT', '10', 'number',
   'Taux de financement annuel servant au calcul du coût de portage (§ 5.4). À CALER SUR LES CONDITIONS BANCAIRES RÉELLES.',
   now()),
  ('DOC_EXPIRY_ALERT_DAYS', '60', 'number',
   'Préavis d''alerte avant expiration d''une pièce de conformité (§ 6.6).',
   now()),
  ('FISCAL_NORMALIZED_INVOICING', 'false', 'boolean',
   'Transmission FNE à la DGI. À activer une fois l''API communiquée (§ 9.5).',
   now()),
  ('CURRENT_FISCAL_YEAR', '2026', 'number',
   'Exercice courant — sélection du taux d''absorption applicable (§ 14.2).',
   now()),
  ('MARGIN_BAND_ALERT_PCT', '15', 'number',
   'Largeur de la bande de surveillance AU-DESSUS du seuil minimum de marge. Une affaire qui s''y trouve n''est pas anormale ; une concentration chez un même commercial l''est (§ 5.4).',
   now()),
  ('MARGIN_VARIANCE_ALERT_PCT', '20', 'number',
   'Écart toléré entre marge approuvée et marge réalisée avant signalement. Vaut dans les deux sens (§ 5.4).',
   now()),
  ('PURCHASE_PRICE_BAND_PCT', '3', 'number',
   'Bande symétrique, en pourcentage, dans laquelle le prix d''achat retenu peut s''écarter du prix fournisseur validé sans motif écrit (§ 5.4). La règle est appliquée EN BASE : la ligne était lue par le déclencheur sans jamais exister, chacun tombant sur son défaut de 3 — donc invisible et inajustable depuis l''écran de paramétrage.',
   now()),
  ('CARRYING_DAYS_PER_YEAR', '360', 'number',
   'Base annuelle du calcul de portage financier — 360 jours en base commerciale (§ 5.4). À aligner sur la convention de la banque : en base 365, le portage retenu ici est surestimé de 1,4 %, et l''inverse si la banque compte en 360 alors qu''on saisit 365. Ne jamais poser 0 : la formule divise par cette valeur.',
   now()),
  ('MARGIN_EXCLUDED_COST_POSTS', 'ACHAT_PRODUIT,PORTAGE_FINANCIER', 'string',
   'Codes des postes de coût direct EXCLUS du cumul des charges, séparés par des virgules : la formule de marge les porte déjà (achat via le prix d''achat, portage via son propre calcul). En retirer un le fait compter DEUX FOIS et effondre la marge affichée ; en ajouter un à tort le fait disparaître du coût de revient (§ 5.4).',
   now()),
  ('FIELD_ATTACHMENT_MAX_MB', '8', 'number',
   'Poids maximal d''une pièce jointe remontée du terrain, en Mo. La tablette compresse avant d''envoyer ; ce plafond est le garde-fou. Trop bas, une photo de scellé prise en plein soleil est refusée et le contrôle reste sans preuve ; trop haut, une opération à vingt photos sature la liaison de l''agent. Un plafond technique de 32 Mo protège la mémoire du serveur en amont, quelle que soit cette valeur.',
   now()),
  ('FIELD_ATTACHMENT_MIME_TYPES', 'image/jpeg,image/png,image/webp,application/pdf', 'string',
   'Types de fichiers admis en pièce jointe du terrain, séparés par des virgules. En retirer un fait refuser les tablettes qui le produisent — certaines n''émettent que du WebP. En ajouter un exécutable n''a aucun sens : le volume de stockage est monté sans droit d''exécution.',
   now()),
  ('LOGIN_MAX_FAILED_ATTEMPTS', '5', 'number',
   'Nombre d''échecs consécutifs avant verrouillage temporaire d''un compte. Trop haut, les essais de mot de passe en série deviennent viables ; trop bas, un utilisateur qui se trompe de clavier s''exclut lui-même. Une valeur inférieure à 1 est ignorée.',
   now()),
  ('LOGIN_LOCK_MINUTES', '15', 'number',
   'Durée du verrouillage après le nombre d''échecs ci-dessus, en minutes. À 0 le verrouillage n''existe plus — la valeur est ignorée et ramenée à 1. Rallonger au-delà de l''heure transforme chaque erreur de saisie en appel au support.',
   now()),
  ('LOGIN_RATE_PER_MINUTE', '30', 'number',
   'Tentatives de connexion tolérées par minute et par ADRESSE IP. Ne protège pas un compte désigné (c''est le rôle du verrouillage ci-dessus) mais l''abus volumétrique. NE PREND EFFET QU''AU REDÉMARRAGE DE L''API. Attention : tout un bureau partage une seule sortie internet, donc un seul compteur.',
   now()),
  ('API_RATE_PER_MINUTE', '120', 'number',
   'Requêtes tolérées par minute et par adresse IP sur l''ensemble de l''API. NE PREND EFFET QU''AU REDÉMARRAGE DE L''API. Trop bas, un écran de pilotage qui rafraîchit ses tuiles bloque son propre utilisateur ; une valeur inférieure à 1 est ignorée, sans quoi l''API se fermerait à tous.',
   now()),
  ('TOTP_REQUIRED_ROLES', 'DG,FINANCE_CFO,ACCOUNTANT,IT_ADMIN', 'string',
   'Rôles internes pour lesquels le second facteur est obligatoire, séparés par des virgules (§ 1.4). Un rôle mal orthographié est ignoré — et le rôle qu''on croyait couvert ne l''est plus. Vider la liste ne désactive pas la 2FA : le système revient à cette liste par défaut.',
   now()),
  ('FNE_API_BASE_URL', 'http://54.247.95.108/ws', 'string',
   'URL de la plateforme FNE — celle de l''environnement de TEST par défaut (procédure DGI, mai 2025). À remplacer par l''URL de production transmise par la DGI après validation des spécimens de factures.',
   now()),
  ('FNE_API_KEY', '', 'string',
   'Clé API (jeton Bearer) fournie par la DGI dans l''onglet « Paramétrage » de l''espace FNE de l''entreprise, après validation de l''inscription. Vide = transmission impossible, quel que soit FISCAL_NORMALIZED_INVOICING.',
   now()),
  ('FNE_POINT_OF_SALE', '', 'string',
   'Identifiant du point de vente tel qu''enregistré sur l''espace FNE d''Elyon (pas une donnée du client). Requis par la DGI sur chaque facture transmise.',
   now()),
  ('FNE_ESTABLISHMENT', '', 'string',
   'Nom de l''établissement tel qu''enregistré sur l''espace FNE d''Elyon (pas une donnée du client). Requis par la DGI sur chaque facture transmise.',
   now()),
  ('FNE_DEFAULT_PAYMENT_METHOD', '', 'string',
   'Mode de règlement pris par défaut à l''édition d''une facture si aucun n''est saisi sur la pièce — une valeur parmi CASH, CARD, CHECK, MOBILE_MONEY, TRANSFER, DEFERRED (vocabulaire imposé par la DGI). Une pièce peut toujours porter un mode différent du défaut. Vide = à saisir systématiquement, aucune FNE ne se transmet sans lui.',
   now()),
  ('DOCUMENT_VERIFY_BASE_URL', '', 'string',
   'Domaine public depuis lequel le lien de vérification imprimé sur le QR code des pièces (proforma, facture, avoir) sera joignable — ex. https://erp.elyon-trading.example. Vide = le lien reste relatif et n''est vérifiable que depuis le réseau interne.',
   now())
ON CONFLICT (key) DO NOTHING;
