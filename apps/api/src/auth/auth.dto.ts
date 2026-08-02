import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Adresse électronique invalide' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @Length(8, 200, { message: 'Mot de passe de 8 caractères minimum' })
  password!: string;

  /** Requis dès lors que le second facteur est activé sur le compte. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code à 6 chiffres attendu' })
  totpCode?: string;
}

export class FieldLoginDto extends LoginDto {
  /** Identifiant de la tablette durcie. Un écart est journalisé (§ 10.5). */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

export class RefreshDto {
  @IsString()
  @MaxLength(2000)
  refreshToken!: string;
}

export class TotpConfirmDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code à 6 chiffres attendu' })
  code!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(200)
  currentPassword!: string;

  /**
   * Politique : 12 caractères minimum. La longueur prime sur la complexité —
   * une phrase de passe longue résiste mieux qu'un « P@ssw0rd! » de 9 signes.
   */
  @IsString()
  @Length(12, 200, { message: 'Nouveau mot de passe de 12 caractères minimum' })
  newPassword!: string;
}
