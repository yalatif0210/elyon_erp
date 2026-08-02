import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import {
  FieldAuthController,
  InternalAuthController,
  PortalAuthController,
} from './auth.controller';
import { TokenService } from './token.service';

/**
 * Authentification des trois réalms.
 *
 * Un seul service, trois contrôleurs : la logique est commune (mot de passe
 * Argon2id, verrouillage après échecs, second facteur, rotation des jetons),
 * seuls diffèrent le périmètre et ce que le jeton emporte.
 *
 * JwtModule est enregistré sans secret global : chaque signature précise le
 * sien. Un secret par défaut ferait courir le risque qu'un oubli fasse signer
 * un refresh token avec la clé d'accès, et rende l'un interchangeable avec
 * l'autre.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [InternalAuthController, PortalAuthController, FieldAuthController],
  providers: [AuthService, TokenService],
  exports: [TokenService],
})
export class AuthModule {}
