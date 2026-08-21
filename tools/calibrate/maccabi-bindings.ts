import {
  maccabiMedicationSelectors,
  scrapePrescriptionRows,
  type ScrapedPrescriptionRow,
} from '../../src/scrapers/maccabi.js';
import type { TargetBindingDefinition } from './binding-resolver.js';

/** Current Maccabi target code exposed to calibration reports. */
export const maccabiBindingDefinitions = {
  medications: {
    bindings: [
      { field: 'rows', selector: maccabiMedicationSelectors.row[0] },
      {
        field: 'name',
        selector: `${maccabiMedicationSelectors.row[0]} ${maccabiMedicationSelectors.name[0]}`,
      },
      {
        field: 'date',
        selector: `${maccabiMedicationSelectors.row[0]} ${maccabiMedicationSelectors.date[0]}`,
      },
      {
        field: 'prescribedBy',
        selector: `${maccabiMedicationSelectors.row[0]} ${maccabiMedicationSelectors.prescriber[0]}`,
      },
      {
        field: 'isStanding',
        selector: `${maccabiMedicationSelectors.row[0]} ${maccabiMedicationSelectors.standingBadge[0]}`,
      },
    ],
    parse: scrapePrescriptionRows,
  } satisfies TargetBindingDefinition<ScrapedPrescriptionRow[]>,
} as const;
