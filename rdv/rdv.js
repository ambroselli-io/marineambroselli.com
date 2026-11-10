/* Prise de rendez-vous — code partagé (vanilla JS, sans build) */
(function () {
  var RDV = (window.RDV = {});

  RDV.api = function (method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) throw new Error(json.error || 'Une erreur est survenue, merci de réessayer.');
        return json;
      });
    });
  };

  RDV.el = function (tag, attrs, children) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    [].concat(children || []).forEach(function (c) {
      if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  };
  var el = RDV.el;

  RDV.guessZone = function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'; } catch (e) { return 'Europe/Paris'; }
  };

  function fmt(iso, zone, opts) {
    return new Intl.DateTimeFormat('fr-FR', Object.assign({ timeZone: zone }, opts)).format(new Date(iso));
  }
  RDV.time = function (iso, zone) { return fmt(iso, zone, { hour: '2-digit', minute: '2-digit' }); };
  RDV.longDate = function (iso, zone) { return fmt(iso, zone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };
  RDV.when = function (startIso, endIso, zone) {
    return RDV.longDate(startIso, zone) + ', ' + RDV.time(startIso, zone) + ' – ' + RDV.time(endIso, zone);
  };
  // YYYY-MM-DD d'un instant dans un fuseau
  function dayKey(iso, zone) {
    var p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { var t = new Date(Date.UTC(y, m, d)); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }

  RDV.zoneLabel = function (zone) {
    return zone === 'Europe/Paris' ? 'Heure de Paris' : zone.replace(/_/g, ' ');
  };

  /**
   * Sélecteur de créneau : mois + jours disponibles + heures.
   * opts = { type, zone, onPick(iso, zone), extraQuery }
   */
  RDV.picker = function (root, opts) {
    var zone = opts.zone || RDV.guessZone();
    var today = dayKey(new Date().toISOString(), zone).split('-').map(Number);
    var cur = { y: today[0], m: today[1] - 1 };
    var first = { y: cur.y, m: cur.m };
    var byDay = {};
    var selected = null;
    var reqId = 0;

    var title = el('div', { class: 'cal__title' });
    var prev = el('button', { type: 'button', 'aria-label': 'Mois précédent', text: '‹', onclick: function () { move(-1); } });
    var next = el('button', { type: 'button', 'aria-label': 'Mois suivant', text: '›', onclick: function () { move(1); } });
    var grid = el('div', { class: 'cal__grid', role: 'grid' });
    var info = el('p', { class: 'cal__empty', hidden: true });
    var slotsBox = el('div', { class: 'stack' });

    var zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = []; }
    if (zones.indexOf(zone) < 0) zones.unshift(zone);
    if (zones.indexOf('Europe/Paris') < 0) zones.unshift('Europe/Paris');
    var tzSelect = el('select', { 'aria-label': 'Fuseau horaire', onchange: function () { zone = tzSelect.value; load(); } },
      zones.map(function (z) { return el('option', { value: z, selected: z === zone, text: RDV.zoneLabel(z) }); }));

    root.innerHTML = '';
    root.appendChild(el('div', { class: 'cal' }, [
      el('div', { class: 'cal__head' }, [title, el('div', { class: 'cal__nav' }, [prev, next])]),
      grid,
      info,
      el('label', { class: 'tz' }, ['Heures affichées :', tzSelect]),
    ]));
    root.appendChild(slotsBox);

    function move(d) {
      var t = new Date(Date.UTC(cur.y, cur.m + d, 1));
      cur = { y: t.getUTCFullYear(), m: t.getUTCMonth() };
      selected = null;
      load();
    }

    function load() {
      var id = ++reqId;
      byDay = {};
      render(true);
      // Marge d'un jour de chaque côté pour les décalages de fuseau.
      var q = '?type=' + encodeURIComponent(opts.type) + '&from=' + ymd(cur.y, cur.m, 0) + '&to=' + ymd(cur.y, cur.m + 1, 1) + (opts.extraQuery || '');
      RDV.api('GET', '/api/slots' + q).then(function (res) {
        if (id !== reqId) return;
        res.slots.forEach(function (s) {
          var k = dayKey(s, zone);
          (byDay[k] = byDay[k] || []).push(s);
        });
        if (!selected) {
          var prefix = cur.y + '-' + pad(cur.m + 1) + '-';
          selected = Object.keys(byDay).sort().filter(function (k) { return k.indexOf(prefix) === 0; })[0] || null;
        }
        render(false);
      }).catch(function (e) {
        if (id !== reqId) return;
        info.hidden = false;
        info.textContent = e.message;
      });
    }

    function render(loading) {
      title.textContent = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(cur.y, cur.m, 1)));
      prev.disabled = cur.y === first.y && cur.m === first.m;
      grid.innerHTML = '';
      ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].forEach(function (d) { grid.appendChild(el('div', { class: 'cal__dow', text: d })); });
      var offset = (new Date(Date.UTC(cur.y, cur.m, 1)).getUTCDay() + 6) % 7;
      for (var i = 0; i < offset; i++) grid.appendChild(el('span'));
      var days = new Date(Date.UTC(cur.y, cur.m + 1, 0)).getUTCDate();
      var prefix = cur.y + '-' + pad(cur.m + 1) + '-';
      var any = false;
      for (var d = 1; d <= days; d++) {
        (function (k, d) {
          var open = !!byDay[k];
          any = any || open;
          grid.appendChild(el('button', {
            type: 'button',
            class: 'cal__day' + (open ? ' cal__day--open' : '') + (k === selected ? ' cal__day--selected' : ''),
            disabled: !open,
            'aria-pressed': k === selected ? 'true' : 'false',
            text: String(d),
            onclick: function () { selected = k; render(false); slotsBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); },
          }));
        })(prefix + pad(d), d);
      }
      info.hidden = loading || any;
      info.textContent = loading ? '' : 'Aucun créneau disponible ce mois-ci. Essayez le mois suivant.';
      slotsBox.innerHTML = '';
      if (loading) { slotsBox.appendChild(el('p', { class: 'loading', text: 'Chargement des disponibilités…' })); return; }
      if (selected && byDay[selected]) {
        slotsBox.appendChild(el('h2', { class: 'slots__title', text: RDV.longDate(byDay[selected][0], zone) }));
        slotsBox.appendChild(el('div', { class: 'slots' }, byDay[selected].map(function (s) {
          return el('button', { type: 'button', class: 'slot', text: RDV.time(s, zone), onclick: function () { opts.onPick(s, zone); } });
        })));
      }
    }

    load();
  };
})();
