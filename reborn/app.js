(function () {
  "use strict";
  const { Game, GODS, SECTORS, clamp } = Reborn;
  const $ = (id) => document.getElementById(id),
    panel = $("panel"),
    overlay = $("overlay");
  const save = {
    get(key, fallback) {
      try {
        return (
          JSON.parse(localStorage.getItem("hubris.reborn." + key)) ?? fallback
        );
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("hubris.reborn." + key, JSON.stringify(value));
      } catch {}
    },
  };
  const sound = new RebornSound(),
    painter = new RebornPainter($("game"));
  let game = new Game(),
    screen = "title",
    paused = false,
    selection = "ares",
    chosenAttack = "ares",
    chosenSpecial = "zeus",
    selectionStep = "attack",
    padIndex = 0,
    padPrevious = [],
    padCooldown = 0,
    padConnected = false,
    padName = "",
    lastTime = 0,
    uiClock = 0,
    toastTime = 0,
    autoFire = save.get("auto", true),
    mode = save.get("mode", "normal");
  const keys = new Set(),
    pressed = new Set();
  sound.music = save.get("music", 0.35);
  sound.effects = save.get("effects", 0.65);
  sound.muted = save.get("muted", false);
  painter.reduced = save.get("reduced", painter.reduced);
  const glyphs = [
    "⌁",
    "☷",
    "☽",
    "ϟ",
    "↟",
    "♡",
    "☼",
    "◇",
    "⋈",
    "↑",
    "⊥",
    "✧",
    "▱",
    "≈",
  ];
  function toast(text) {
    $("toast").textContent = text;
    $("toast").classList.add("show");
    toastTime = 3;
  }
  function syncSound() {
    sound.settings();
    $("sound-toggle").textContent = sound.muted ? "SOUND OFF" : "SOUND ON";
    $("sound-toggle").setAttribute(
      "aria-label",
      sound.muted ? "Unmute audio" : "Mute audio",
    );
    save.set("muted", sound.muted);
  }
  function show(type, html) {
    keys.clear();
    pressed.clear();
    screen = type;
    overlay.hidden = false;
    overlay.className = "overlay" + (type === "title" ? " title" : "");
    panel.innerHTML = html;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const heading = panel.querySelector("h1,h2");
    if (heading) {
      heading.id = "panel-heading";
      panel.setAttribute("aria-labelledby", "panel-heading");
    }
    panel.scrollTop = 0;
    padIndex = 0;
    highlightPad();
  }
  function hide() {
    keys.clear();
    pressed.clear();
    document.activeElement?.blur();
    overlay.hidden = true;
    screen = "playing";
  }
  function button(label, action, style = "primary") {
    return `<button class="${style}" data-action="${action}">${label}</button>`;
  }
  function title() {
    game = new Game();
    paused = false;
    show(
      "title",
      `<div class="eyebrow">BULLET HELL / ROGUELITE</div><h1>HUBRIS</h1><div class="title-sub">REBORN</div><p>Fourteen gods. Two powers.<br>Build your run. Find your opening.</p>${button("Begin ascent  →", "begin")}<div>${button("Settings & controls", "settings", "text")}</div><p class="small">Keyboard or controller · Auto-fire ${autoFire ? "on" : "off"}</p>`,
    );
    $("pause-button").hidden = true;
    $("combat-top").hidden = true;
    $("combat-bottom").hidden = true;
    renderLoadout();
    hud();
  }
  function selectGod(step) {
    selectionStep = step;
    selection = step === "attack" ? chosenAttack : chosenSpecial;
    game.state = "select";
    const special = step === "special";
    show(
      "select",
      `<div class="panel-head"><div><div class="eyebrow">${special ? "02 / 02 — YOUR CALL" : "01 / 02 — YOUR WEAPON"}</div><h2>${special ? "Choose a special." : "Choose your patron."}</h2><p>${special ? "A separate power. Recharges during combat." : "Every god changes the way you fight."}</p></div>${button("Back", "back", "text")}</div><div class="god-grid">${GODS.map((g, i) => `<button class="god-card" style="--god:${g.color}" data-god="${g.id}" aria-pressed="${g.id === selection}"><span class="glyph" aria-hidden="true">${glyphs[i]}</span><strong>${g.name}</strong><small>${special ? g.special : g.weapon}</small></button>`).join("")}</div><div class="selection-detail"><div><h3 id="choice-name"></h3><p id="choice-desc"></p></div>${button(special ? "Enter the gate →" : "Choose special →", "confirm-god")}</div>`,
    );
    selectionDetail();
  }
  function selectionDetail() {
    const g = GODS.find((g) => g.id === selection);
    $("choice-name").textContent =
      selectionStep === "attack" ? g.weapon : g.special;
    $("choice-desc").textContent =
      selectionStep === "attack" ? g.desc : g.sdesc;
    panel
      .querySelectorAll("[data-god]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", b.dataset.god === selection),
      );
  }
  function start() {
    game = new Game(Date.now());
    game.start(chosenAttack, chosenSpecial, mode);
    keys.clear();
    pressed.clear();
    paused = false;
    hide();
    $("pause-button").hidden = false;
    $("combat-top").hidden = false;
    $("combat-bottom").hidden = false;
    renderLoadout();
    sound.unlock();
  }
  function renderLoadout() {
    if (!game.attack) {
      $("loadout").innerHTML =
        '<div class="empty-sigil">✧</div><h3>Your loadout</h3><p>Choose a god for your attack and a god for your special.</p>';
      return;
    }
    $("loadout").innerHTML =
      [
        ["ATTACK", game.attack, game.attack.weapon, game.attack.desc],
        [
          "SPECIAL",
          game.specialGod,
          game.specialGod.special,
          game.specialGod.sdesc,
        ],
      ]
        .map(
          ([label, g, w, d]) =>
            `<div class="loadout-item"><div class="eyebrow">${label}</div><h3 style="color:${g.color}">${g.name}</h3><b>${w}</b><p>${d}</p></div>`,
        )
        .join("") +
      `<div class="stat-chip">POWER ${Math.round(game.damage * 100)}% · RATE ${Math.round(game.fireRate * 100)}%</div>`;
  }
  const upgrades = [
    {
      id: "power",
      name: "Sharpened edge",
      desc: "Every attack and special deals more damage.",
      value: "+12% BASE DAMAGE",
    },
    {
      id: "tempo",
      name: "Quickening",
      desc: "Your weapon fires more often.",
      value: "+8% BASE FIRE RATE",
    },
    {
      id: "charge",
      name: "Second wind",
      desc: "Your special recharges faster.",
      value: "+20% BASE RECHARGE",
    },
    {
      id: "graze",
      name: "Close passage",
      desc: "Near misses build Apotheosis faster.",
      value: "+35% BASE GRAZE CHARGE",
    },
    {
      id: "repair",
      name: "Mending",
      desc: "Restore one life and gain Apotheosis charge.",
      value: "+1 LIFE · +20 CHARGE",
    },
  ];
  function draft() {
    const list = [
      upgrades[(game.wave + game.sector) % 4],
      upgrades[(game.wave + game.sector + 2) % 4],
      game.p.hp < game.maxhp
        ? upgrades[4]
        : upgrades[(game.wave + game.sector + 1) % 4],
    ];
    show(
      "draft",
      `<div class="panel-head"><div><div class="eyebrow">WAVE CLEAR · +12 GOLD</div><h2>Choose a boon.</h2><p>Choose one free boon. Your gold is saved for the next shop.</p></div><div class="balance">${game.wallet} GOLD</div></div><div class="cards">${list.map((u, i) => `<button class="upgrade" data-upgrade="${u.id}"><span class="number">0${i + 1} / BOON</span><h3>${u.name}</h3><p>${u.desc}</p><span class="value">${u.value}</span></button>`).join("")}</div><div class="panel-actions"><p class="small">Press 1–3 or choose a card. Controller: D-pad + A.</p></div>`,
    );
  }
  function shop() {
    show(
      "shop",
      `<div class="panel-head"><div><div class="eyebrow">GUARDIAN CLEAR · +55 GOLD</div><h2>Shop</h2><p>Spend what you need. One life is restored when you leave.</p></div><div class="balance">${game.wallet} GOLD</div></div><div class="cards">${[
        {
          id: "repair",
          name: "Mend the hull",
          desc: "Restore one life now.",
          value: `${game.p.hp} / ${game.maxhp} LIVES`,
          blocked: game.p.hp >= game.maxhp,
        },
        {
          id: "power",
          name: "Reforge",
          desc: "All attacks and specials deal +25% base damage.",
          value: `CURRENT POWER ${Math.round(game.damage * 100)}%`,
        },
        {
          id: "capacity",
          name: "Deep reserves",
          desc: "Add one special slot and fill it. Maximum four.",
          value: `${game.specialCap} SPECIAL SLOTS`,
          blocked: game.specialCap >= 4,
        },
      ]
        .map(
          (u) =>
            `<button class="upgrade" data-buy="${u.id}" ${u.blocked || game.wallet < game.price(u.id) ? "disabled" : ""}><span class="number">${u.blocked ? "AT CAPACITY" : game.price(u.id) + " GOLD"}</span><h3>${u.name}</h3><p>${u.desc}</p><span class="value">${u.value}</span></button>`,
        )
        .join(
          "",
        )}</div><div class="eyebrow shop-subhead">BOONS & GOD POWERS</div><div class="cards">${game.offers
        .map((o) => {
          const g = o.god,
            u = upgrades.find((u) => u.id === o.boon),
            same =
              o.id === "attack"
                ? game.attack.id === g?.id
                : game.specialGod.id === g?.id;
          const name = g ? g.name : u.name;
          const desc =
            o.id === "attack"
              ? same
                ? "Strengthen your current weapon. +20% base damage."
                : `Replace your attack with ${g.weapon}. ${g.desc}`
              : o.id === "special"
                ? same
                  ? "Strengthen your current special. +35% base recharge."
                  : `Replace your special with ${g.special}. ${g.sdesc}`
                : u.desc;
          return `<button class="upgrade" data-buy="${o.id}" ${game.shopBought.includes(o.id) || game.wallet < game.price(o.id) ? "disabled" : ""}><span class="number">${game.shopBought.includes(o.id) ? "PURCHASED" : game.price(o.id) + " GOLD"}</span><h3>${name}</h3><p>${desc}</p><span class="value">${g ? o.id.toUpperCase() + " BOON" : u.value}</span></button>`;
        })
        .join(
          "",
        )}</div><div class="panel-actions"><p class="small">Repeat purchases cost more. Gold carries between regions.</p>${button("Continue · +1 life →", "leave-shop")}</div>`,
    );
  }
  function results() {
    const win = game.state === "win",
      previous = save.get("best", 0),
      best = Math.max(previous, game.score);
    save.set("best", best);
    show(
      "results",
      `<div class="eyebrow">${win ? "THREE GUARDIANS FALLEN" : "THE ASCENT ENDS"}</div><h2>${win ? "Run complete." : "Run ended."}</h2><p>${win ? "All three guardians defeated." : `You reached ${SECTORS[game.sector].name}. Try a different pairing, or return with the same gods.`}</p><div class="results"><div><strong>${game.score.toLocaleString()}</strong><span>SCORE${game.score > previous ? " · NEW BEST" : ""}</span></div><div><strong>${game.grazes}</strong><span>GRAZES</span></div><div><strong>${Math.floor(game.elapsed / 60)}:${String(Math.floor(game.elapsed % 60)).padStart(2, "0")}</strong><span>TIME</span></div></div><div class="panel-actions">${button("Change gods", "change", "secondary")}${button("Fly again →", "retry")}</div><p class="small">${game.mode === "gentle" ? "Gentle" : "Standard"} · Run seed ${game.seed}</p>`,
    );
    $("pause-button").hidden = true;
  }
  function settings(fromPause = false) {
    if (fromPause) paused = true;
    show(
      fromPause ? "pause" : "settings",
      `<div class="settings"><div class="eyebrow">${fromPause ? "RUN PAUSED" : "PREFERENCES"}</div><h2>${fromPause ? "Paused." : "Settings & controls"}</h2><label class="setting">Music <input id="music" type="range" min="0" max="100" value="${sound.music * 100}"></label><label class="setting">Effects <input id="effects" type="range" min="0" max="100" value="${sound.effects * 100}"></label><label class="setting">Auto-fire <input id="auto" class="check" type="checkbox" ${autoFire ? "checked" : ""}></label><label class="setting">Reduced motion <input id="reduced" class="check" type="checkbox" ${painter.reduced ? "checked" : ""}></label>${!fromPause ? `<div class="setting"><span>Next run</span>${button(mode === "gentle" ? "Gentle · 5 lives" : "Standard · 3 lives", "difficulty", "secondary")}</div>` : ""}<p><b>Keyboard</b> — WASD / arrows to move. Shift to focus. Space to dash. X for special. C for Apotheosis. Z to fire manually. Esc to pause. M to mute.</p><p><b>Controller</b> — Left stick / D-pad to move. LB / LT to focus. B to dash. X for special. Y for Apotheosis. Hold A / RT to fire manually. Start to pause. Menus: D-pad / stick to navigate, A to choose, B to go back.</p><p class="small">Standard-mapped Xbox and PlayStation controllers. On PlayStation: A = Cross, B = Circle, X = Square, Y = Triangle. Press a button to connect.</p><div class="panel-actions">${fromPause ? button("End run", "quit", "text") : ""}${button(fromPause ? "Resume →" : "Back →", fromPause ? "resume" : "title")}</div></div>`,
    );
  }
  function pause() {
    if (game.state !== "playing") return;
    if (paused) {
      paused = false;
      keys.clear();
      hide();
    } else settings(true);
  }
  function action(id) {
    sound.unlock();
    switch (id) {
      case "begin":
      case "change":
        selectGod("attack");
        break;
      case "back":
        if (selectionStep === "special") selectGod("attack");
        else title();
        break;
      case "confirm-god":
        if (selectionStep === "attack") {
          chosenAttack = selection;
          selectGod("special");
        } else {
          chosenSpecial = selection;
          start();
        }
        break;
      case "retry":
        start();
        break;
      case "leave-shop":
        game.leaveShop();
        hide();
        renderLoadout();
        break;
      case "settings":
        settings();
        break;
      case "difficulty":
        mode = mode === "normal" ? "gentle" : "normal";
        save.set("mode", mode);
        settings();
        break;
      case "title":
        title();
        break;
      case "resume":
        paused = false;
        keys.clear();
        hide();
        break;
      case "quit":
        show(
          "quit",
          `<h2>End this ascent?</h2><p>Your current run will end. Your personal best stays saved.</p><div class="panel-actions">${button("Keep playing", "resume", "secondary")}${button("End run", "confirm-quit")}</div>`,
        );
        break;
      case "confirm-quit":
        title();
        break;
    }
    hud();
  }
  panel.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.god) {
      selection = b.dataset.god;
      selectionDetail();
      return;
    }
    if (b.dataset.upgrade) {
      game.choose(b.dataset.upgrade);
      hide();
      renderLoadout();
      return;
    }
    if (b.dataset.buy) {
      if (game.buy(b.dataset.buy)) {
        toast("Purchase complete");
        shop();
        renderLoadout();
      }
      return;
    }
    if (b.dataset.action) action(b.dataset.action);
  });
  panel.addEventListener("input", (e) => {
    const el = e.target;
    if (["music", "effects"].includes(el.id)) {
      sound[el.id] = Number(el.value) / 100;
      save.set(el.id, sound[el.id]);
      sound.unlock();
      sound.settings();
    }
    if (el.id === "auto") {
      autoFire = el.checked;
      save.set("auto", autoFire);
    }
    if (el.id === "reduced") {
      painter.reduced = el.checked;
      save.set("reduced", painter.reduced);
    }
  });
  $("sound-toggle").onclick = () => {
    sound.unlock();
    sound.muted = !sound.muted;
    syncSound();
  };
  $("pause-button").onclick = pause;
  window.addEventListener("keydown", (e) => {
    const inMenu = !overlay.hidden;
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
        e.code,
      ) &&
      !["INPUT", "SELECT"].includes(e.target.tagName)
    )
      e.preventDefault();
    if (!keys.has(e.code) && !inMenu) pressed.add(e.code);
    keys.add(e.code);
    if (e.repeat) return;
    sound.unlock();
    if (e.code === "KeyM") {
      sound.muted = !sound.muted;
      syncSound();
    }
    if (e.code === "Escape" || e.code === "KeyP") {
      e.preventDefault();
      if (screen === "playing" || screen === "pause") pause();
      else if (screen === "quit") action("resume");
      else if (screen === "settings") title();
      else if (screen === "select") action("back");
      return;
    }
    if (
      inMenu &&
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) &&
      e.target.type !== "range"
    ) {
      e.preventDefault();
      moveMenu(
        e.code === "ArrowRight" ? 1 : e.code === "ArrowLeft" ? -1 : 0,
        e.code === "ArrowDown" ? 1 : e.code === "ArrowUp" ? -1 : 0,
      );
    }
    if (inMenu && e.code === "Space" && e.target.tagName === "BUTTON") {
      e.preventDefault();
      e.target.click();
    }
    if (screen === "draft" && ["Digit1", "Digit2", "Digit3"].includes(e.code))
      panel
        .querySelectorAll("[data-upgrade]")
        [Number(e.code.slice(-1)) - 1]?.click();
    if (inMenu && e.code === "Tab") {
      const controls = menuControls();
      if (!controls.length) return;
      const current = controls.indexOf(document.activeElement);
      if (e.shiftKey && current <= 0) {
        e.preventDefault();
        controls.at(-1).focus();
      } else if (!e.shiftKey && current === controls.length - 1) {
        e.preventDefault();
        controls[0].focus();
      }
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => {
    keys.clear();
    pressed.clear();
    if (screen === "playing" && game.state === "playing") pause();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      keys.clear();
      pressed.clear();
      if (screen === "playing" && game.state === "playing") pause();
    }
  });
  function menuControls() {
    return [...panel.querySelectorAll("*")].filter(
      (el) =>
        (el.tagName === "BUTTON" || el.tagName === "INPUT") && !el.disabled,
    );
  }
  panel.addEventListener("focusin", (e) => {
    const i = menuControls().indexOf(e.target);
    if (i >= 0) {
      padIndex = i;
      panel
        .querySelectorAll(".pad-focus")
        .forEach((x) => x.classList.remove("pad-focus"));
      if (padConnected) e.target.classList.add("pad-focus");
    }
  });
  function highlightPad() {
    const controls = menuControls();
    if (!controls.length) return;
    padIndex = clamp(padIndex, 0, controls.length - 1);
    panel
      .querySelectorAll(".pad-focus")
      .forEach((x) => x.classList.remove("pad-focus"));
    const el = controls[padIndex];
    if (padConnected) el.classList.add("pad-focus");
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  }
  function moveMenu(x, y) {
    const controls = menuControls();
    if (!controls.length) return;
    const current = controls[padIndex];
    if (current?.type === "range" && x) {
      current.value = clamp(Number(current.value) + Math.sign(x) * 5, 0, 100);
      current.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    let delta = y ? Math.sign(y) : Math.sign(x);
    const grid = current?.closest(".god-grid,.cards");
    if (y && grid) {
      const cols = getComputedStyle(grid)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length;
      delta *= Math.max(1, cols);
    }
    padIndex = (padIndex + delta + controls.length) % controls.length;
    highlightPad();
  }
  function readPad(dt) {
    let pads = [];
    try {
      pads = [...(navigator.getGamepads?.() || [])];
    } catch {}
    const pad = pads.find((p) => p && p.mapping === "standard");
    if (!pad) {
      if (padConnected) {
        const wasPlaying = screen === "playing";
        if (wasPlaying) pause();
        toast(
          wasPlaying
            ? "Controller disconnected. Game paused."
            : "Controller disconnected.",
        );
        padConnected = false;
        padName = "";
        $("controller").textContent = "KEYBOARD / MOUSE";
        $("control-note").textContent =
          "WASD: move · Shift: focus · Space: dash · X: special · C: Apotheosis";
        panel
          .querySelectorAll(".pad-focus")
          .forEach((x) => x.classList.remove("pad-focus"));
      }
      padPrevious = [];
      return {};
    }
    if (!padConnected || padName !== pad.id) {
      padConnected = true;
      padName = pad.id;
      padPrevious = pad.buttons.map((b) => b.pressed);
      toast("Controller connected");
      $("controller").textContent = "CONTROLLER CONNECTED";
      $("control-note").textContent =
        "Stick: move · LB: focus · B: dash · X: special · Y: Apotheosis";
      if (!overlay.hidden) highlightPad();
    }
    const down = (i) => !!pad.buttons[i]?.pressed,
      edge = (i) => down(i) && !padPrevious[i];
    const dead = (v) =>
      Math.abs(v) < 0.18 ? 0 : (Math.sign(v) * (Math.abs(v) - 0.18)) / 0.82;
    const ax = dead(pad.axes[0] || 0),
      ay = dead(pad.axes[1] || 0);
    const x = clamp(ax + (down(15) ? 1 : 0) - (down(14) ? 1 : 0), -1, 1),
      y = clamp(ay + (down(13) ? 1 : 0) - (down(12) ? 1 : 0), -1, 1);
    const wasPlaying = overlay.hidden,
      startPressed = edge(9);
    if (pad.buttons.some((b) => b.pressed)) sound.unlock();
    if (startPressed) pause();
    if (!overlay.hidden && !startPressed) {
      padCooldown -= dt;
      const mx = Math.abs(x) > 0.5 ? Math.sign(x) : 0,
        my = Math.abs(y) > 0.5 ? Math.sign(y) : 0;
      if (!mx && !my) padCooldown = 0;
      if (padCooldown <= 0 && (mx || my)) {
        moveMenu(mx, my);
        padCooldown = 0.19;
      }
      const current = menuControls()[padIndex];
      if (edge(0)) {
        if (current?.type === "checkbox") {
          current.checked = !current.checked;
          current.dispatchEvent(new Event("input", { bubbles: true }));
        } else current?.click();
      } else if (edge(1)) {
        if (screen === "pause" || screen === "quit") action("resume");
        else if (screen === "settings") title();
        else if (screen === "select") action("back");
      }
    }
    const result =
      wasPlaying && overlay.hidden && !startPressed
        ? {
            x,
            y,
            focus: down(4) || down(6),
            dash: edge(1),
            special: edge(2),
            ascend: edge(3),
            fire: down(0) || down(7),
          }
        : {};
    padPrevious = pad.buttons.map((b) => b.pressed);
    return result;
  }
  function hud() {
    const active = !!game.attack;
    $("score").textContent = String(
      active ? game.score : save.get("best", 0),
    ).padStart(6, "0");
    $("score-label").textContent = active ? "RUN SCORE" : "PERSONAL BEST";
    $("wallet").textContent = active ? game.wallet : "—";
    if (!active) {
      $("region-title").innerHTML = "Three regions.<br>One ascent.";
      $("region-sub").innerHTML =
        "Choose two powers.<br>Survive the guardians.";
      return;
    }
    $("region-title").textContent = SECTORS[game.sector].name;
    $("region-sub").textContent = SECTORS[game.sector].sub;
    [...$("route").children].forEach((el, i) =>
      el.classList.toggle("current", i === game.sector),
    );
    $("lives").textContent =
      "◆".repeat(Math.max(0, game.p.hp)) +
      "◇".repeat(Math.max(0, game.maxhp - game.p.hp));
    $("lives").setAttribute(
      "aria-label",
      `${game.p.hp} of ${game.maxhp} lives`,
    );
    $("wave-label").textContent =
      game.wave === 6 ? "GUARDIAN" : `WAVE ${game.wave} / 5`;
    const boss = game.enemies.find((e) => e.boss);
    $("boss-hud").hidden = !boss;
    if (boss) {
      $("boss-name").textContent = boss.name.toUpperCase();
      $("boss-phase").textContent = `PHASE ${boss.phase + 1} / 5`;
      $("boss-fill").style.width =
        `${Math.max(0, boss.hp / boss.maxhp) * 100}%`;
    }
    $("charge-fill").style.width =
      `${game.apoth > 0 ? (game.apoth / 7) * 100 : game.charge}%`;
    $("charge-fill").parentElement.classList.toggle(
      "ready",
      game.charge >= 100 || game.apoth > 0,
    );
    $("charge-label").textContent =
      game.apoth > 0
        ? `ACTIVE · ${game.apoth.toFixed(1)}s`
        : game.charge >= 100
          ? "READY · C / Y"
          : `${Math.floor(game.charge)}% · C / Y`;
    $("special-label").textContent =
      `SPECIAL ${"◆".repeat(Math.floor(game.special))}${"◇".repeat(game.specialCap - Math.floor(game.special))} · X`;
    $("dash-label").textContent =
      game.p.dash > 0 ? `DASH ${game.p.dash.toFixed(1)}s` : "DASH READY";
    $("footer-hint").textContent =
      game.attack.id === "ares"
        ? `War heat ${Math.round(game.heat * 100)}% · Full strength in 1.5s`
        : `${game.attack.name} + ${game.specialGod.name} · ${game.mode === "gentle" ? "Gentle" : "Standard"}`;
  }
  function frame(ms) {
    const dt = Math.min(0.034, (ms - lastTime) / 1000 || 0.016);
    lastTime = ms;
    const pad = readPad(dt);
    if (!paused && screen === "playing") {
      const x =
          (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
          (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) +
          (pad.x || 0),
        y =
          (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) -
          (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) +
          (pad.y || 0);
      game.focus = keys.has("ShiftLeft") || keys.has("ShiftRight") || pad.focus;
      game.update(dt, {
        x,
        y,
        focus: game.focus,
        fire: !!(autoFire || keys.has("KeyZ") || pad.fire),
        dash: pressed.has("Space") || pad.dash,
        special: pressed.has("KeyX") || pad.special,
        ascend: pressed.has("KeyC") || pad.ascend,
      });
    }
    pressed.clear();
    for (const e of game.events.splice(0)) {
      sound.event(e);
      if (e.type === "draft") draft();
      if (e.type === "shop") shop();
      if (e.type === "end") results();
    }
    sound.tick(game, paused || document.hidden);
    painter.render(game, paused ? 0 : dt);
    uiClock += dt;
    if (uiClock > 0.1) {
      uiClock = 0;
      hud();
    }
    if (toastTime > 0) {
      toastTime -= dt;
      if (toastTime <= 0) $("toast").classList.remove("show");
    }
    requestAnimationFrame(frame);
  }
  new ResizeObserver(() => painter.resize()).observe($("arena"));
  syncSound();
  title();
  requestAnimationFrame(frame);
})();
