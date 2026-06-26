/* Shared Skill Check rules.
   The renderer and debug diagnostics both use this module so skill/check
   recognition does not drift between rendering and validation. */

const RendScrollSkillChecks = (() => {
  const ABILITY = {
    str: { icon: "💪", full: "Strength" },
    dex: { icon: "🏃", full: "Dexterity" },
    con: { icon: "❤️", full: "Constitution" },
    int: { icon: "🧠", full: "Intelligence" },
    wis: { icon: "👁", full: "Wisdom" },
    cha: { icon: "💬", full: "Charisma" },
  };

  const ABILITY_ALIAS = {
    str: "str", strength: "str",
    dex: "dex", dexterity: "dex",
    con: "con", constitution: "con",
    int: "int", intelligence: "int",
    wis: "wis", wisdom: "wis",
    cha: "cha", charisma: "cha",
  };

  const SKILL_ABILITY = {
    athletics: "str",
    acrobatics: "dex", "sleight of hand": "dex", stealth: "dex",
    arcana: "int", history: "int", investigation: "int", nature: "int", religion: "int",
    "animal handling": "wis", insight: "wis", medicine: "wis", perception: "wis", survival: "wis",
    deception: "cha", intimidation: "cha", performance: "cha", persuasion: "cha",
  };

  const SPELL = [
    { re: /^(swd|speak with dead)$/, disp: "SWD", icon: "💀", noDC: true },
    { re: /^(dt|detect thoughts?)$/, disp: "DT", icon: "🧠", noDC: false },
    { re: /^(swa|speak with animals?)$/, disp: "SWA", icon: "🐾", noDC: false },
    { re: /detect magic/, disp: null, icon: "✨", noDC: false },
  ];

  const PASSIVE = /passive|ilk bak/;

  function lower(name) {
    if (typeof RendScrollParser !== "undefined" && RendScrollParser.lower) {
      return RendScrollParser.lower(name);
    }
    return String(name).replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
  }

  function normalizedKey(name) {
    return lower(name).replace(/ı/g, "i");
  }

  function resolveSkill(name) {
    const lname = lower(name);
    const key = lname.replace(/ı/g, "i");

    const spell = SPELL.find((s) => s.re.test(key));
    if (spell) {
      return {
        display: spell.disp || name,
        icon: spell.icon,
        mystic: true,
        noDC: spell.noDC,
        standard: true,
      };
    }

    if (PASSIVE.test(lname)) {
      return { display: name, icon: "👁", mystic: true, noDC: false, standard: true };
    }

    const abilKey = ABILITY_ALIAS[key];
    if (abilKey) {
      return {
        display: ABILITY[abilKey].full,
        icon: ABILITY[abilKey].icon,
        mystic: false,
        noDC: false,
        standard: true,
      };
    }

    const skillAbil = SKILL_ABILITY[key];
    if (skillAbil) {
      return {
        display: name,
        icon: ABILITY[skillAbil].icon,
        mystic: false,
        noDC: false,
        standard: true,
      };
    }

    return { display: name, icon: null, mystic: false, noDC: false, standard: false };
  }

  function isStandardCheck(name) {
    return resolveSkill(name).standard;
  }

  function isNoDcCheck(name) {
    return resolveSkill(name).noDC;
  }

  return {
    resolveSkill,
    isStandardCheck,
    isNoDcCheck,
    normalizedKey,
  };
})();

if (typeof window !== "undefined") window.RendScrollSkillChecks = RendScrollSkillChecks;
if (typeof module !== "undefined" && module.exports) module.exports = RendScrollSkillChecks;
