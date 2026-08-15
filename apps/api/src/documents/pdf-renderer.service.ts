import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser } from 'puppeteer-core';

/**
 * MOTEUR HEADLESS DE GÉNÉRATION PDF (§ 1.1).
 *
 * Un seul navigateur Chromium partagé, pas un par document : le lancer coûte
 * plusieurs centaines de millisecondes, et une facture ne mérite pas de le
 * payer à chaque fois. Chaque rendu ouvre sa propre page et la ferme —
 * l'isolation vient de la page, pas du processus.
 *
 * Le binaire est celui du paquet Alpine `chromium` (voir docker/api.Dockerfile),
 * pas celui que `puppeteer` télécharge lui-même : ce dernier est lié à la
 * glibc et ne s'exécute pas sous musl.
 */
@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRendererService.name);
  private browserPromise: Promise<Browser> | null = null;

  private async browser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = this.launch();
    }
    try {
      const browser = await this.browserPromise;
      if (!browser.connected) throw new Error('déconnecté');
      return browser;
    } catch {
      // Le navigateur a crashé ou s'est déconnecté entre deux jobs — on en
      // relance un plutôt que d'échouer indéfiniment jusqu'au redémarrage
      // de l'API.
      this.browserPromise = this.launch();
      return this.browserPromise;
    }
  }

  private async launch(): Promise<Browser> {
    const { launch } = await import('puppeteer-core');
    return launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      headless: true,
      // ⚠️ `--disable-crash-reporter` NE SUFFIT PAS.
      //
      //    Le conteneur est en lecture seule hors /tmp (tmpfs, seule
      //    exception). Sans HOME sur un répertoire inscriptible, Chromium
      //    tente quand même de créer la base de son gestionnaire de plantage
      //    sous le HOME hérité (souvent `/`), et `chrome_crashpad_handler`
      //    s'arrête net — « --database is required » suivi d'un SIGTRAP,
      //    AVANT même que `--disable-crash-reporter` ne soit pris en compte.
      //    Constaté en lançant le binaire à la main dans le conteneur.
      env: { ...process.env, HOME: '/tmp', XDG_CONFIG_HOME: '/tmp/.config', XDG_CACHE_HOME: '/tmp/.cache' },
      args: [
        // Le bac à sable propre de Chromium exige des privilèges que
        // `cap_drop: ALL` (docker-compose.yml) retire délibérément — la
        // frontière de sécurité est le conteneur, pas Chromium lui-même.
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--user-data-dir=/tmp/chromium-profile',
        '--disable-crash-reporter',
        // Aucun rendu 3D à faire pour un document HTML/CSS : le composeur
        // logiciel suffit, et évite le détour par SwiftShader constaté sinon.
        '--disable-gpu',
      ],
    });
  }

  /** Rend un document HTML autonome (CSS inline) en PDF A4. */
  async renderPdf(html: string): Promise<Buffer> {
    const browser = await this.browser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'a4',
        printBackground: true,
        margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      const browser = await this.browserPromise;
      await browser?.close();
    } catch (e) {
      this.logger.warn(`Fermeture de Chromium : ${(e as Error).message}`);
    }
  }
}
