-- AlterTable
-- La colonne manquait sur field_users alors que le code de verrouillage
-- (AuthService.registerFailure) supposait pouvoir compter les echecs avant
-- de verrouiller, comme pour users et portal_users. Son absence forcait un
-- verrouillage immediat au premier mot de passe refuse pour un compte
-- terrain, sans seuil - voir le commentaire dans auth.service.ts.
ALTER TABLE "field_users" ADD COLUMN "failed_login_attempts" SMALLINT NOT NULL DEFAULT 0;
