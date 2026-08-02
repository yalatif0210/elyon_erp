# CAHIER DE CADRAGE FONCTIONNEL ERP — PETRO DISTRIBUTION
## Version consolidée 2.0 — 1er août 2026

# 1. Vision et objectif

Petro Distribution souhaite déployer un ERP intégré couvrant le négoce, la distribution et le transport d’hydrocarbures, l’exploitation d’une barge, les opérations terrain, le HSE, le CRM, la facturation, la fiscalité, la comptabilité, la trésorerie, les ressources humaines et la paie.

L’ERP devra constituer le système central de gestion et supprimer les traitements en silos.

Chaîne de valeur cible :

> Prospect → Opportunité → Chiffrage → Offre/Proforma → Contrat/Commande → Approvisionnement → Opération → Contrôles HSE → Livraison → Facturation → Encaissement → Comptabilisation → Rentabilité → Fidélisation

# 2. Principes directeurs

L’ERP devra être intégré, modulaire, paramétrable, multi-segment, multidevise, mobile, utilisable hors connexion, sécurisé, traçable et évolutif. Les règles fiscales, comptables, HSE, commerciales et monétaires devront être configurables et non codées en dur.

# 3. Segments commerciaux et facturation

## 3.1 Maritime

Le segment maritime couvre la fourniture de produits aux navires.

Pour les opérations éligibles à une facturation HT :

> Prix de vente HT = Prix de base/CIF HT + Prime ou marge + Transport + Frais administratifs + Autres coûts

Les navires de pêche bénéficiant d’une exonération applicable pourront être facturés HT. Les navires non exonérés pourront être facturés TTC, avec comme référence le prix à la pompe et, le cas échéant, une réduction commerciale.

> Prix TTC = Prix à la pompe – Réduction

La réduction pourra être un montant par litre ou un pourcentage. Le prix de vente devra rester distinct du prix réel d’achat.

## 3.2 B2B

Les clients B2B peuvent appartenir aux secteurs minier, BTP, industriel ou public.

Le prix devra intégrer le prix d’achat, le transport, l’administration, les coûts opérationnels et HSE, les remises, les taxes et la marge.

> Prix de vente = Coût complet + Marge + Taxes applicables

## 3.3 Retail

Le Retail concerne principalement les stations-service.

> Prix de cession = Prix à la pompe – Marge attribuée à la station

Le coût complet intégrera l’achat, le transport, la logistique, l’administration, le HSE et les autres charges.

# 4. Référentiels

## 4.1 Clients

Chaque client devra disposer d’une fiche comprenant identité, contacts, informations fiscales, segment, conditions commerciales, devise, plafond de crédit, conditions de paiement, contrats, historique des opérations, factures et encaissements.

## 4.2 Produits

Le référentiel devra gérer le type, la qualité, les spécifications, les unités (litre, m³, tonne), les paramètres techniques utiles et le régime fiscal.

## 4.3 Fournisseurs

La base fournisseurs devra contenir l’identité, les documents, les coordonnées bancaires, les produits, les prix, les devises, les modalités de fixation des prix, les conditions de livraison et de paiement, les volumes, remises, taxes, contrats et statut de conformité.

Les prix devront être historisés avec dates de validité, source, contrat et validation.

## 4.4 Sous-traitants de transport

La base devra couvrir les données administratives, contrats, tarifs, agréments, véhicules, capacités, chauffeurs, assurances, contrôles techniques, formations, conformité HSE, incidents et non-conformités.

Un sous-traitant, véhicule ou chauffeur non conforme ne devra pas être affecté sans dérogation formalisée.

## 4.5 Postes de coûts

L’ERP devra gérer les coûts d’achat, chargement, déchargement, manutention, transit, frais portuaires, stockage, throughput, transport, péages, attente, frais de route, administration, banque, commissions, HSE, assurances, pénalités et coûts exceptionnels.

# 5. Achats, approvisionnement et stocks

Le système devra gérer les demandes d’achat, consultations, commandes fournisseurs, contrats, réceptions, contrôles de quantité et qualité, factures fournisseurs, paiements, stocks, transferts, pertes et valorisation.

Les produits pourront être acquis auprès de la SIR, via les mécanismes applicables avec GESTOCI, auprès d’un marketeur ou d’autres fournisseurs autorisés.

Les stocks devront distinguer les produits de Petro Distribution, les produits de clients ou tiers, les produits en transit et les produits à bord de la barge. Les produits de tiers ne devront jamais être valorisés comme stocks de Petro Distribution.

# 6. Gestion opérationnelle et état d’avancement

Chaque opération devra avoir un identifiant unique, par exemple OP-2026-000154, et contenir le segment, client, contrat, produit, propriétaire du produit, volumes, fournisseur, origine, destination, moyen de transport, responsables, dates, devise, prix, coûts et marge prévisionnels.

Workflow indicatif :

> Brouillon → Demande reçue → Étude de faisabilité → Devis → Validation commerciale → Approvisionnement → Préparation HSE → Planification → Chargement → Transport → Livraison → Contrôle final → Facturation → Clôture

Chaque étape devra être horodatée, affectée à un responsable et conservée dans la piste d’audit.

Le tableau de bord devra afficher les opérations à venir, en cours, en retard, bloquées, non conformes HSE, livrées non facturées et facturées non encaissées.

# 7. Application terrain sur tablette

Les équipes terrain devront utiliser une application ou interface tablette intégrée à l’ERP.

Fonctions requises :

- opérations affectées ;
- checklists dynamiques ;
- validation étape par étape ;
- saisie des volumes ;
- photos et pièces jointes ;
- signatures électroniques ;
- déclaration d’incidents ;
- horodatage ;
- géolocalisation si activée ;
- mode hors connexion ;
- synchronisation automatique.

Checklist type :

## Préparation

Ordre de mission, client, produit, volume, site, transporteur, véhicule et chauffeur confirmés.

## Contrôles HSE avant départ

Permis, assurance, contrôle technique, extincteurs, EPI, kit anti-déversement, signalisation, absence de fuite et briefing sécurité.

## Chargement

Autorisation, contrôle du produit et des compartiments, volume enregistré, bon joint et contrôle HSE validé.

## Transport

Départ, avancement, incidents et arrivée.

## Livraison

Sécurisation du site, volume livré, écarts, bon signé, signature électronique et photos.

## Clôture

Contrôle HSE final, incident ou quasi-accident, rapport et validation finale.

# 8. HSE intégré

Le HSE devra être intégré au workflow de chaque opération.

Des modèles de contrôle devront être disponibles pour les livraisons terrestres, chargements, déchargements, opérations maritimes, opérations de barge, transferts, transports pour compte de client, maintenances et opérations exceptionnelles.

Chaque contrôle pourra être obligatoire, recommandé, conditionnel ou bloquant.

Le système devra gérer inspections, incidents, accidents, déversements, quasi-accidents, observations dangereuses, non-conformités, actions correctives et préventives, responsables, échéances et preuves de clôture.

# 9. Rapport automatique d’opération

À la clôture, l’ERP devra générer un rapport PDF lié à chaque opération, incluant :

- numéro et nature ;
- client et produit ;
- volumes prévus, chargés et livrés ;
- écarts ;
- dates et heures ;
- intervenants ;
- transporteur ou barge ;
- checklist opérationnelle ;
- contrôles HSE ;
- incidents ;
- photos ;
- signatures ;
- pièces jointes ;
- coûts prévisionnels et réels ;
- chiffre d’affaires ;
- marges ;
- statut final.

# 10. Gestion de la barge

La barge devra être gérée comme actif immobilisé, moyen opérationnel, centre de coût, centre de profit lorsqu’elle génère des revenus, objet de maintenance, périmètre HSE et emplacement de stock mobile lorsque le produit appartient à Petro Distribution.

## 10.1 Référentiel

Nom, identification, pavillon, type, année, propriétaire, exploitant, port d’attache, capacités, compartiments, produits autorisés, équipements, certificats, assurances, inspections et échéances.

## 10.2 Produit de Petro Distribution

Flux :

> Stock Petro Distribution → Chargement sur barge → Transport → Livraison → Mise à jour du stock → Facturation

La barge pourra être un emplacement de stock mobile. Le transfert vers la barge sera un mouvement interne et non une vente.

Le transport pourra être inclus dans le prix, facturé séparément ou intégré au coût de revient.

## 10.3 Produit du client

Flux :

> Produit du client → Chargement → Transport → Déchargement → Facturation de la prestation

Le produit sera suivi comme marchandise de tiers et non comme stock valorisé de Petro Distribution.

La prestation pourra être tarifée au voyage, au litre, au m³, à la tonne, à la distance, à la durée, au forfait ou selon une combinaison.

## 10.4 Maintenance et disponibilité

Maintenance préventive et corrective, ordres de travail, pièces, coûts, indisponibilités et alertes.

Statuts : disponible, en opération, en attente, en maintenance, immobilisée, non conforme ou hors service.

## 10.5 HSE de la barge

Évaluations des risques, plans de prévention, contrôles avant opération, EPI, équipements incendie et antipollution, kits de déversement, exercices, incidents et actions correctives.

# 11. CRM et suivi des prospects

Le CRM devra couvrir :

> Prospect → Qualification → Opportunité → Offre/Devis → Négociation → Contrat/Commande → Client → Opération → Facture → Encaissement → Fidélisation

La fiche prospect devra inclure identité, secteur, localisation, contacts, source, besoin, volumes estimés, segment, budget, devise, potentiel, maturité, capacité financière et probabilité de conversion.

Pipeline :

> Nouveau → À contacter → Contact établi → Besoin identifié → Qualifié → Opportunité ouverte → Offre en préparation → Offre envoyée → Négociation → Décision attendue → Gagnée/Perdue/Mise en veille

Chaque étape devra avoir une date, un responsable, une probabilité, une valeur et une prochaine action.

Le CRM devra enregistrer appels, courriels, réunions, visites, messages, offres, comptes rendus, documents et réclamations. Chaque interaction devra comporter une action suivante et une date de relance.

Les alertes devront couvrir les relances du jour, les actions en retard, les prospects non contactés et les opportunités sans activité.

Chaque opportunité devra contenir produit ou service, volume, prix, devise, CA prévisionnel, coût, marge, probabilité, date de clôture et responsable.

> Valeur pondérée = CA prévisionnel × Probabilité

Un prospect gagné devra être converti en client sans duplication, avec conservation de l’historique.

# 12. Proformas, factures simples et FNE

L’ERP devra gérer :

1. proforma ;
2. facture simple ;
3. FNE ;
4. autres régimes paramétrés.

## 12.1 Proforma

La proforma servira à présenter une offre, confirmer les prix et quantités, obtenir l’accord ou solliciter un paiement anticipé.

Elle devra porter la mention :

> DOCUMENT PROFORMA – NON VALABLE COMME FACTURE DÉFINITIVE

Elle ne devra pas générer automatiquement de créance définitive, de chiffre d’affaires, d’écriture fiscale ou de transmission FNE.

Elle devra pouvoir être convertie en commande, contrat, opération, facture simple ou FNE.

## 12.2 Facture simple

Dans les cas spécifiques applicables, Petro Distribution pourra facturer après présentation d’une proforma et émettre une facture simple sans génération de FNE.

La facture devra être liée à la proforma, au contrat, à la commande ou à l’opération et contenir numéro, date, client, produits ou services, quantités, prix, remises, HT, taxes, TTC, devise, conditions de paiement et références opérationnelles.

## 12.3 FNE

Lorsqu’une opération relève du processus FNE applicable, l’ERP devra préparer et contrôler les données, transmettre via l’API de la DGI, recevoir les statuts, intégrer les références retournées, gérer les erreurs et renvois, archiver les échanges et gérer les avoirs ou régularisations.

Statuts :

> Brouillon → À valider → En attente de transmission → Transmise → Acceptée/Certifiée → Rejetée → À corriger → Annulée/Régularisée

## 12.4 Moteur de règles

Le choix du document devra être paramétrable selon le client, pays, statut fiscal, produit ou prestation, segment, régime fiscal, devise, contrat, lieu de livraison, caractère local ou international, exonération et règles internes.

Champ obligatoire :

> Régime documentaire et fiscal : Proforma uniquement / Proforma puis facture simple / Proforma puis FNE / Facture simple directe / FNE directe / Autre régime

Le motif de non-recours à la FNE devra être enregistré lorsque nécessaire.

# 13. Gestion multidevise

L’ERP devra gérer au minimum XOF/FCFA, EUR et USD, ainsi que toute devise activée. Aucune devise ne devra être codée en dur.

Il distinguera devise fonctionnelle, de transaction, contractuelle, de règlement et de reporting.

Il devra gérer les prix par devise, taux de change, sources et dates, taux officiels, bancaires, contractuels, internes ou budgétaires, conversions, gains et pertes de change, réévaluations et reporting.

Les transactions validées devront conserver leur taux historique.

En cas de changement de devise en Côte d’Ivoire, le système devra permettre l’ajout d’une devise, une date de bascule, une coexistence temporaire, la conversion des soldes, la conservation des historiques, la mise à jour des prix et rapports et une piste d’audit.

# 14. Coût complet et rentabilité

> Coût complet = Achat + Approvisionnement + Transport + Administration + HSE + Barge + Autres coûts

> Marge brute = CA – Coût d’achat

> Marge opérationnelle = CA – Coût complet

Les analyses devront être disponibles par opération, client, produit, segment, fournisseur, transporteur, barge, site, contrat, période et devise.

# 15. Finance, comptabilité et trésorerie

Le module devra couvrir :

- plan comptable ;
- journaux ;
- comptabilité générale ;
- comptabilité clients et fournisseurs ;
- écritures automatiques ;
- écritures manuelles contrôlées ;
- comptabilité analytique ;
- centres de coûts ;
- immobilisations ;
- amortissements ;
- provisions ;
- clôtures ;
- balances ;
- grand livre ;
- bilan ;
- compte de résultat ;
- tableaux de trésorerie.

Les schémas comptables devront être paramétrables et compatibles avec les exigences applicables, notamment le SYSCOHADA révisé, sous validation du conseil comptable.

## Trésorerie et banques

Gestion des comptes XOF, EUR et USD, virements, chèques, dépôts, retraits, frais bancaires, avances, paiements clients, règlements fournisseurs et prévisions de trésorerie.

## Rapprochements bancaires

Import des relevés, rapprochement automatique et manuel, identification des écarts, suivi des mouvements non rapprochés, frais bancaires, écritures d’ajustement, validation et archivage.

# 16. RH et paie

Le module devra gérer employés, contrats, postes, services, catégories, salaires, primes, indemnités, avances, prêts, retenues, absences, congés, heures supplémentaires, éléments variables, frais de mission, bulletins, états de paie, déclarations applicables et écritures comptables.

Les paramètres devront être configurables.

Workflow :

> Préparation → Contrôle RH → Contrôle Finance → Validation Direction → Paiement → Comptabilisation

Les coûts de personnel devront pouvoir être imputés aux opérations, à la barge, aux centres de coûts ou projets.

# 17. Contrôles, sécurité et workflows

L’ERP devra gérer les rôles et droits, la séparation des tâches, la piste d’audit, les validations et les dérogations.

Il devra empêcher ou contrôler :

- fournisseurs non validés ;
- moyens de transport non conformes ;
- documents expirés ;
- prix ou remises non autorisés ;
- marges sous seuil ;
- opérations déficitaires ;
- doubles facturations ;
- modifications de documents validés.

Workflow indicatif :

> Saisie → Contrôle opérationnel → Validation commerciale → Validation financière → Validation HSE/Conformité → Approbation Direction

# 18. Tableaux de bord

## Commercial et CRM

Prospects, pipeline, conversion, CA prévisionnel, offres, performance commerciale et marges.

## Opérations

Statuts, retards, blocages, volumes, livraisons et opérations non facturées.

## HSE

Taux de conformité, contrôles, incidents, non-conformités, actions en retard et performance par équipe, transporteur et barge.

## Achats

Volumes, prix fournisseurs, évolution des prix, contrats et dettes.

## Transport et barge

Voyages, volumes, coûts, performance, conformité, utilisation, disponibilité, revenus, marge, maintenance et incidents.

## Finance

CA, coûts, marges, trésorerie, créances, dettes, impayés, écarts de change et rapprochements.

# 19. Architecture cible

- Référentiels : clients, prospects, fournisseurs, produits, sites, contrats, devises ;
- CRM : prospection, opportunités, relances, offres, conversion ;
- Ventes : devis, proformas, contrats, commandes, prix, remises ;
- Achats : demandes, commandes, réceptions, factures fournisseurs ;
- Stocks : dépôts, lots, mouvements, pertes, produits de tiers ;
- Opérations : workflow, étapes, responsables, délais ;
- Terrain : tablettes, checklists, photos, signatures, mode hors ligne ;
- HSE : contrôles, incidents, non-conformités, actions ;
- Transport : sous-traitants, véhicules, chauffeurs, voyages ;
- Barge : exploitation, stocks, maintenance, coûts ;
- Facturation : proforma, facture simple, FNE, multidevise ;
- Fiscalité : API DGI, statuts et archivage ;
- Comptabilité : général, auxiliaire, analytique, immobilisations ;
- Trésorerie : banques, paiements, rapprochements ;
- RH/Paie : employés, temps, paie, écritures ;
- Pilotage : KPI, marges, rentabilité et prévisions.

# 20. Feuille de route recommandée

## Phase 1 — Must Have

Référentiels, CRM, achats, ventes, proformas, factures simples, FNE, stocks, opérations, application tablette, checklists HSE, rapports d’opération, multidevise et tableaux de bord essentiels.

## Phase 2 — Should Have

Transport terrestre, sous-traitants, véhicules, chauffeurs, barge, maintenance, coût complet et rentabilité par opération.

## Phase 3 — Finance

Comptabilité générale, auxiliaires, analytique, trésorerie, rapprochements, immobilisations et reporting.

## Phase 4 — RH et paie

Dossiers employés, absences, temps, paie, déclarations et intégration comptable.

## Phase 5 — Pilotage avancé

Budgets, prévisions, business intelligence, alertes avancées et analyses prédictives.

# 21. Résultat attendu

L’ERP devra permettre de connaître en temps réel :

- l’état des prospects et la prochaine action commerciale ;
- le fournisseur, le prix d’achat et la devise ;
- la propriété du produit ;
- l’état d’avancement de chaque opération ;
- les contrôles HSE réalisés et les blocages ;
- les moyens de transport mobilisés ;
- la disponibilité et la rentabilité de la barge ;
- les volumes chargés et livrés ;
- les coûts engagés ;
- le document à émettre : proforma, facture simple ou FNE ;
- le statut de facturation et d’encaissement ;
- la marge réelle ;
- l’impact des devises ;
- l’état des rapprochements bancaires ;
- les coûts de personnel ;
- la rentabilité par client, segment, opération et actif.

L’ERP devra devenir le système intégré de pilotage commercial, opérationnel, logistique, HSE, financier, fiscal et RH de Petro Distribution.
