// AllergyAlertModal — special-case wrapper around DDIAlertModal that filters
// to allergy-kind alerts only (for screens that only care about that subset).

import DDIAlertModal from "./DDIAlertModal.js";
import type { FormularyAlert } from "@pharmacare/formulary";

interface AllergyAlertModalProps {
  alerts: readonly FormularyAlert[];
  onAcknowledge: () => void;
  onClose: () => void;
}

export default function AllergyAlertModal(props: AllergyAlertModalProps): React.ReactElement | null {
  const filtered = props.alerts.filter((a) => a.kind === "allergy");
  if (filtered.length === 0) return null;
  return <DDIAlertModal {...props} alerts={filtered} />;
}
