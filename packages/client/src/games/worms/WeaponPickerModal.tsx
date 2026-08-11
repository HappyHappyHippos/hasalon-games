import { useState, type JSX } from 'react';
import { WEAPONS, type WeaponSpec, type WormsWeaponId } from '@mg/shared/worms';
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
            const spec = WEAPONS[id];
            const left = ammo[id];
            const empty = left !== undefined && left <= 0;
            const isSelected = current === id;
            const name = t.wormsWeaponNames?.[id] ?? id;
            const category = getCategoryTag(id, spec);

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
                  <span className={`worms__picker-card-tag worms__picker-card-tag--${category.key}`}>
                    {category.label}
                  </span>
                </div>
                <div className="worms__picker-card-ammo">
                  {left !== undefined ? left : '∞'}
                </div>
              </button>
            );
          })}
        </div>

        {/* Blueprint / Field Note Instruction Card */}
        {activeSpec && (
          <div className="worms__picker-info">
            <div className="worms__picker-info-head">
              <div className="worms__picker-info-icon">
                <WormsWeaponIcon id={activeId} size={28} />
              </div>
              <div className="worms__picker-info-titles">
                <span className="worms__picker-info-name">{activeName}</span>
                <span className="worms__picker-info-mode">
                  {getCategoryTag(activeId, activeSpec).label}
                </span>
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

function getCategoryTag(
  id: WormsWeaponId,
  spec: WeaponSpec,
): { key: string; label: string } {
  if (id === 'bazooka' || id === 'cluster') return { key: 'power', label: 'Power Shot' };
  if (id === 'grenade') return { key: 'fuse', label: 'Fuse 1-5s' };
  if (id === 'shotgun') return { key: 'direct', label: '2 Shots' };
  if (id === 'bat') return { key: 'melee', label: 'Melee' };
  if (id === 'dynamite') return { key: 'drop', label: 'Drop 4s' };
  if (id === 'homing' || id === 'airstrike') return { key: 'target', label: 'Map Target' };
  if (id === 'mine') return { key: 'proximity', label: 'Mine' };
  if (id === 'teleport') return { key: 'utility', label: 'Utility' };
  if (spec.needsTarget) return { key: 'target', label: 'Map Target' };
  return { key: 'direct', label: 'Direct' };
}
