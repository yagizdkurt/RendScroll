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
    acrobatics: "dex", "sleight of hand": "dex", lockpicking: "dex", stealth: "dex",
    arcana: "int", history: "int", investigation: "int", nature: "int", religion: "int",
    "animal handling": "wis", insight: "wis", medicine: "wis", perception: "wis", survival: "wis",
    deception: "cha", intimidation: "cha", performance: "cha", persuasion: "cha",
  };

  const SKILL_ALIAS = {
    "lock picking": "lockpicking",
    lockping: "lockpicking",
    "sleight of hands": "sleight of hand",
  };

  const SKILL_DISPLAY = {
    "sleight of hand": "Sleight of Hand",
    lockpicking: "Lockpicking",
  };

  const SKILL_OPTION_NAMES = [
    "Athletics",
    "Acrobatics",
    "Sleight of Hand",
    "Lockpicking",
    "Stealth",
    "Arcana",
    "History",
    "Investigation",
    "Nature",
    "Religion",
    "Animal Handling",
    "Insight",
    "Medicine",
    "Perception",
    "Survival",
    "Deception",
    "Intimidation",
    "Performance",
    "Persuasion",
    "STR",
    "DEX",
    "CON",
    "INT",
    "WIS",
    "CHA",
    "STR Save",
    "DEX Save",
    "CON Save",
    "INT Save",
    "WIS Save",
    "CHA Save",
    "Passive Perception",
    "SWD",
    "DT",
    "SWA",
    "Detect Magic",
  ];

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

    const save = key.match(/^(.+?)\s+(?:save|saving throw)$/);
    if (save) {
      const saveAbilKey = ABILITY_ALIAS[save[1].trim()];
      if (saveAbilKey) {
        return {
          display: ABILITY[saveAbilKey].full + " Save",
          icon: ABILITY[saveAbilKey].icon,
          mystic: false,
          noDC: false,
          standard: true,
        };
      }
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

    const skillKey = SKILL_ALIAS[key] || key;
    const skillAbil = SKILL_ABILITY[skillKey];
    if (skillAbil) {
      return {
        display: SKILL_DISPLAY[skillKey] || name,
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

  function skillOptions() {
    return SKILL_OPTION_NAMES.map((name) => ({ value: name, label: name }));
  }

  return {
    resolveSkill,
    isStandardCheck,
    isNoDcCheck,
    normalizedKey,
    skillOptions,
  };
})();

if (typeof window !== "undefined") window.RendScrollSkillChecks = RendScrollSkillChecks;
if (typeof module !== "undefined" && module.exports) module.exports = RendScrollSkillChecks;
