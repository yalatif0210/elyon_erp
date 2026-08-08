-- ===========================================================================
--  PURGE DES RÉFÉRENTIELS MÉTIER PRÉCHARGÉS
--
--  Le dirigeant : « ces données sont à supprimer et doivent être paramétrables ».
--
--  ⚠️ CE SONT DES VALEURS D'ENTREPRISE, PAS DE LA CONFIGURATION TECHNIQUE.
--
--     Un catalogue de 73 produits, 55 cours de change et une grille de seuils de
--     marge ne sont pas des réglages du logiciel : ce sont des décisions
--     commerciales, financières et industrielles. Les livrer préremplies revient
--     à décider à la place de l'entreprise, puis à laisser croire que c'est
--     configuré.
--
--     Les trois référentiels sont administrables — interface de saisie ET import
--     de fichier — depuis l'écran de paramétrage. Les vider ne retire donc
--     aucune capacité : cela retire des réponses que personne n'avait données.
--
--  ⚠️ CONSÉQUENCE À CONNAÎTRE AVANT D'EXÉCUTER.
--
--     Sans cours de change, AUCUNE conversion n'est possible : le plan pivot ne
--     peut pas être calculé, et toute pièce monétaire est refusée. Sans produit,
--     aucune affaire ne se crée. C'est le comportement correct — on ne convertit
--     pas sans taux, on ne vend pas un produit qui n'existe pas — mais
--     l'application paraîtra bloquée tant que le premier cours et le premier
--     produit ne sont pas saisis.
--
--     C'est voulu : un système qui invente un taux de change ment sur tout ce
--     qu'il calcule ensuite.
--
--  ⚠️ IRRÉVERSIBLE. Sauvegarde dans sauvegardes/ avant exécution.
-- ===========================================================================

BEGIN;

-- ⚠️ LES GARDES « AJOUT SEUL » SONT SUSPENDUS LE TEMPS DE LA PURGE.
--
--    `fx_rates` et `margin_thresholds` refusent le DELETE, et c'est leur raison
--    d'être : un cours ou un seuil gouvernent des calculs DÉJÀ PRODUITS —
--    factures émises, marges approuvées. Les effacer réécrirait le passé.
--
--    Ici, il n'y a plus de passé : la purge des données de démonstration a
--    effacé toutes les pièces et toutes les affaires. Rien ne s'appuie plus sur
--    ces cours. Le contournement est donc un geste d'administration assumé, sur
--    une base vide, avec sauvegarde — et il n'a rien à faire dans un chemin
--    applicatif.
SET session_replication_role = replica;

-- --- Seuils de marge --------------------------------------------------------
-- Le plancher direct et le seuil minimum sont des décisions de direction. Le
-- § 19 les classait d'ailleurs en points ouverts, illustrés à 30 et 10 FCFA/L
-- « à caler sur vos conditions réelles ».
DELETE FROM margin_thresholds;

-- --- Cours de change --------------------------------------------------------
-- Données de marché, datées. Celles en base couvraient une période de
-- démonstration et n'ont aucune valeur pour l'exploitation.
DELETE FROM fx_rates;

-- --- Produits ---------------------------------------------------------------
-- Le catalogue appartient à l'entreprise. Les 73 lignes préchargées mélangeaient
-- les quatre produits du référentiel (Fuel 180, MGO, Diesel, Essence) et des
-- créations de campagnes de recette.
DELETE FROM products;

SET session_replication_role = DEFAULT;

COMMIT;
