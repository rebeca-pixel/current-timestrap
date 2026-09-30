import { useState } from 'react';
import ShiftSelector from '../ShiftSelector';

export default function ShiftSelectorExample() {
  const [shiftHours, setShiftHours] = useState<4 | 8 | 12>(8);
  
  return (
    <div className="bg-slate-950 min-h-screen p-6">
      <ShiftSelector 
        shiftHours={shiftHours}
        onShiftChange={setShiftHours}
        totalWorkedMinutes={240}
        onFinalSubmit={() => console.log('Final submit clicked')}
        canSubmit={false}
      />
    </div>
  );
}
