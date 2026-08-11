import { useState, type JSX } from 'react';
import { WEAPONS, type WormsWeaponId } from '@mg/shared/worms';
import { useT } from '../../strings';
import { WormsWeaponIcon } from './WormsWeaponIcons';

interface Props {
  open: boolean;
  onClose: () => void;
  weapons: WormsWeaponId[];
  current: WormsWeaponId;
  ammo: Record<string, number>;
  onPick: (id: WormsWeaponId) => void;
}

export function WeaponPickerModal({
  open,
  onClose,
  weapons,
  current,
  ammo,
  onPick,
}: Props): JSX.Element | null {
  const [hovered, setHovered] = useState<WormsWeaponId | null>(null);
  const t = useT();

  if (!open) return null;

  const activeId = hovered ?? current;
  const activeSpec = WEAPONS[activeId];
  const activeName = t.wormsWeaponNames?.[activeId] ?? activeId;
  const activeInfo = t.wormsWeaponInfo?.[activeId] ?? '';

  return (
    <div className="worms__picker-overlay" onClick={onClose}>
      <div className="worms__picker-panel" onClick={(e) => e.stopPropagation()}>
        {/* Comic Header Banner */}
        <div className="worms__picker-head">
          <div className="worms__picker-head-title">
            <span className="worms__picker-badge">ARSENAL</span>
            <h2 className="worms__picker-title">{t.wormsSelectWeapon}</h2>
          </div>
          <button
            type="button"
            className="worms__picker-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Weapons Grid */}
        <div className="worms__picker-grid">
          {weapons.map((id) => {
            const left = ammo[id];
            const empty = left !== undefined && left <= 0;
            const isSelected = current === id;
            const name = t.wormsWeaponNames?.[id] ?? id;

            return (
              <button
                key={id}
                type="button"
                disabled={empty}
                className={`worms__picker-card${isSelected ? ' worms__picker-card--selected' : ''}${
                  empty ? ' worms__picker-card--empty' : ''
                }`}
                onClick={() => {
                  onPick(id);
                  onClose();
                }}
                onMouseEnter={() => setHovered(id)}
                onMouseLeave={() => setHovered(null)}
                aria-label={name}
              >
                <div className="worms__picker-card-icon">
                  <WormsWeaponIcon id={id} size={32} />
                </div>
                <div className="worms__picker-card-body">
                  <span className="worms__picker-card-name">{name}</span>
                </div>
                <div className="worms__picker-card-ammo">
                  {left !== undefined ? left : '∞'}
                </div>
              </button>
            );
          })}
        </div>

        {/* Tactical Instruction Blueprint Card */}
        {activeSpec && (
          <div className="worms__picker-info">
            <div className="worms__picker-info-head">
              <div className="worms__picker-info-icon">
                <WormsWeaponIcon id={activeId} size={28} />
              </div>
              <div className="worms__picker-info-titles">
                <span className="worms__picker-info-name">{activeName}</span>
              </div>
              {activeSpec.ammo >= 0 && (
                <span className="worms__picker-info-badge">
                  {ammo[activeId] ?? activeSpec.ammo} left
                </span>
              )}
            </div>
            <p className="worms__picker-info-desc">
              <span className="worms__picker-info-tip">💡 </span>
              {activeInfo}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
