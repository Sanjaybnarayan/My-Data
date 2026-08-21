/**
 * Assembling what is covered.
 *
 * `domain/warranty.js` decides; this loads the two lists it decides over, so
 * two screens cannot disagree about what "still under warranty" means.
 */

import { Service } from './service.js';
import { cover, unwarranted, describeCover } from '../domain/warranty.js';

export class BelongingsService extends Service {
  async cover({ today = new Date().toISOString().slice(0, 10) } = {}) {
    const purchases = await this.repo('purchase').list({ limit: 1000 });
    const warranties = await this.repo('warranty').list({ limit: 1000 });

    const rows = cover(warranties, purchases, today);
    const gaps = unwarranted(purchases, warranties);
    return { rows, gaps, line: describeCover(rows, gaps) };
  }
}
