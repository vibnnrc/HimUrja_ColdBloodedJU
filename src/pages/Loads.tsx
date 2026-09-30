import React, { useMemo } from 'react';
import { LuHeartPulse, LuHouse, LuFlaskConical, LuCalendarClock, LuShieldAlert, LuThermometerSnowflake, LuLeaf } from 'react-icons/lu';
import { useApp } from '../state';
import { Panel, Kpi, Badge, kfmt } from '../ui/kit';
import { TimeChart } from '../ui/charts';
import { COL, timeTicks, labelTime, fmtDayTime } from './common';
import { optimizeAI } from '../opt/dispatch';

export function LoadsPage() {
  const { snap: s, st } = useApp();
  const ms = s.ms;
  const surplus = s.planCrit.map((c, i) => s.wind[i] + s.pv[i] - c);
  const shifted = s.dr.defer.reduce((a, v, i) => a + Math.abs(v - s.deferBase[i]), 0) / 2;
  const noDr = useMemo(() => {
    const load = s.planCrit.map((c, i) => c + s.deferBase[i]);
    return optimizeAI({ st, load, heat: s.heat, wind: s.wind, pv: s.pv, reserve: s.reserve, soc0: s.soc0, prevOn: s.prevOn, prevOn2: s.prevOn2, socLevels: 31 });
  }, [s, st]);
  const drSaving = noDr.totals.fuel - s.ai.totals.fuel;
  const greenShare = (d: number[]) => {
    let tot = 0,
      green = 0;
    d.forEach((v, i) => {
      tot += v;
      green += Math.min(v, Math.max(0, surplus[i]));
    });
    return tot > 0 ? green / tot : 0;
  };
  const shareAI = greenShare(s.dr.defer);
  const shareBase = greenShare(s.deferBase);
  const science = st.load.science + (st.load.ageos ? 3 : 0);

  const tiers = [
    {
      icon: <LuHeartPulse />,
      tier: 'Tier 1 - Critical',
      color: COL.bad,
      items: `Life support (heating circulation, ventilation, water), medical bay, communications/VSAT${st.load.ageos ? ', AGEOS satellite ground station' : ''}, fire & safety systems`,
      kw: s.planCrit[0] - (s.planCrit[0] - science) * 0.55,
      policy: 'Never shed. Always covered by online capacity + battery reserve.',
    },
    {
      icon: <LuHouse />,
      tier: 'Tier 2 - Essential',
      color: COL.warn,
      items: 'Living quarters, galley, lighting, workshops in use, science instruments with continuous records',
      kw: (s.planCrit[0] - science) * 0.55,
      policy: 'Kept on; peak smoothing (galley ovens staggered) and 1 °C night set-back in unoccupied zones.',
    },
    {
      icon: <LuCalendarClock />,
      tier: 'Tier 3 - Flexible',
      color: COL.ice,
      items: `${st.load.waterPlantName} (tank buffered), laundry, workshop batch jobs, vehicle battery charging`,
      kw: s.dr.defer[0],
      policy: 'Scheduled into renewable-surplus hours; first to be shed in an emergency.',
    },
  ];

  const ladder = [
    { lvl: 'Normal', trig: 'All systems healthy', act: 'Economic dispatch; flexible loads follow wind & sun', c: COL.ok },
    { lvl: 'Alert', trig: 'Blizzard forecast, genset trip, or fuel < reserve + 20%', act: 'Pre-charge battery, commit standby genset, defer all Tier 3 loads', c: COL.warn },
    { lvl: 'Conserve', trig: 'Fuel below reserve floor or two gensets unavailable', act: 'Shed Tier 3, 2 °C set-back in non-living zones, staggered galley use', c: COL.diesel },
    { lvl: 'Survival', trig: 'Single genset / battery only', act: 'Only Tier 1: life support, medical, comms - automatic breaker sequencing', c: COL.bad },
  ];

  return (
    <div className="stack">
      <div className="grid g4">
        <Kpi icon={<LuCalendarClock />} label="Flexible energy re-timed (48 h)" value={kfmt(shifted)} unit="kWh" foot="moved into wind/solar surplus hours" color={COL.ice} />
        <Kpi icon={<LuLeaf />} label="Fuel saved by smart scheduling" value={kfmt(Math.max(0, drSaving), 1)} unit="L / 48 h" foot={`≈ ${kfmt(Math.max(0, drSaving) * 182.5)} L/yr at this rate`} color={COL.ok} />
        <Kpi icon={<LuThermometerSnowflake />} label="Flexible load on wind/solar" value={kfmt(shareAI * 100)} unit="%" foot={`fixed schedule: ${kfmt(shareBase * 100)}%`} color={COL.wind} bar={shareAI} />
        <Kpi icon={<LuFlaskConical />} label="Science load protected" value={kfmt(science)} unit="kW" foot="never curtailed by the optimiser" color={COL.battery} />
      </div>

      <Panel title="Load priority tiers" hint="what can move, what can never be touched">
        <div className="grid g3">
          {tiers.map((t) => (
            <div key={t.tier} className="cmp" style={{ borderColor: t.color + '55' }}>
              <h4 style={{ color: t.color }}>
                {t.icon} {t.tier}
              </h4>
              <div className="big" style={{ fontSize: 20 }}>
                {kfmt(t.kw)} <small className="muted" style={{ fontSize: 12 }}>kW now</small>
              </div>
              <div className="muted" style={{ fontSize: 12.5, margin: '6px 0' }}>
                {t.items}
              </div>
              <div style={{ fontSize: 12.5 }}>{t.policy}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Flexible loads - fixed schedule vs optimised schedule" hint="bars = flexible load kW · line = forecast renewable surplus" right={<Badge kind="ice">{s.dr.moves.length} jobs planned</Badge>}>
        <TimeChart
          n={48}
          height={260}
          xLabel={(i) => labelTime(ms[i])}
          tipTitle={(i) => fmtDayTime(ms[i])}
          xTicks={timeTicks(ms, 6)}
          yUnit="kW"
          zeroLine
          series={[
            { key: 'base', label: 'Fixed daytime schedule', color: '#475569', kind: 'bar', data: s.deferBase, stack: 'a', opacity: 0.9 },
            { key: 'ai', label: 'HimUrja schedule', color: COL.ice, kind: 'bar', data: s.dr.defer, stack: 'b', opacity: 0.85 },
            { key: 'sur', label: 'Renewable surplus (wind + solar - critical load)', color: COL.wind, kind: 'line', data: surplus, width: 2 },
          ]}
        />
        <div className="note mt">
          Water production is buffered by storage tanks and laundry/workshop jobs only need to finish within the day, so they can follow the wind. Days only partly inside the 48 h window keep their fixed
          schedule until the full day is visible.
        </div>
      </Panel>

      <Panel title="Emergency load-shedding ladder" hint="automatic, pre-agreed with the Station Leader" right={<LuShieldAlert style={{ color: COL.warn, fontSize: 18 }} />}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Level</th>
                <th>Trigger</th>
                <th>Automatic action</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((l) => (
                <tr key={l.lvl}>
                  <td>
                    <Badge kind="">
                      <i className="sw" style={{ background: l.c }} />
                      {l.lvl}
                    </Badge>
                  </td>
                  <td className="muted">{l.trig}</td>
                  <td>{l.act}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
