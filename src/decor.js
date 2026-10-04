/* Doodle Alive: collage decorations for the site.
   Every shape is drawn here as inline SVG (torn paper with halftone dots, graph-paper
   scraps, starbursts, sparkles, a brush stroke, neon squiggles). No images from the web.
   Loaded as a classic script; attaches to DA.decor. */
(function () {
  "use strict";
  var DA = (globalThis.DA = globalThis.DA || {});

  var C = {
    paper: "#FFFDF8",
    ink: "#24203A",
    periwinkle: "#9C9BE3",
    lilac: "#CDBDF2",
    pink: "#F27BB1",
    pinkSoft: "#FBD3E4",
    butter: "#FAD15A",
    butterSoft: "#FDECB0",
    grid: "#7D7BD6",
    lime: "#D6F53C",
    cyan: "#3DD5F0"
  };

  var uid = 0;
  function nid(prefix) {
    uid += 1;
    return prefix + uid;
  }

  function svg(viewBox, inner, extra) {
    return (
      '<svg viewBox="' + viewBox + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"' +
      (extra || "") + ">" + inner + "</svg>"
    );
  }

  /* ---------- shapes ---------- */

  var TORN = [
    "M14 40 L44 18 L66 30 L98 10 L128 26 L158 8 L188 36 L180 70 L196 100 L178 132 L192 164 L158 182 L134 170 L106 192 L76 174 L46 188 L20 162 L30 130 L8 102 L26 72 Z",
    "M10 30 L52 14 L84 28 L120 8 L162 24 L190 12 L198 58 L182 92 L196 126 L172 150 L186 184 L140 190 L112 176 L78 196 L44 178 L16 190 L24 150 L6 118 L22 84 Z",
    "M20 20 L60 34 L96 12 L132 30 L170 14 L192 52 L176 84 L194 118 L168 140 L180 176 L136 164 L100 190 L66 170 L30 186 L12 148 L28 116 L8 80 L26 52 Z"
  ];

  /* A torn-paper blob with a halftone (printed dot) texture. */
  function torn(color, variant) {
    var id = nid("ht");
    var d = TORN[(variant || 0) % TORN.length];
    return svg(
      "0 0 200 200",
      '<defs><pattern id="' + id + '" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">' +
        '<circle cx="4.5" cy="4.5" r="1.7" fill="#fff" opacity=".5"/></pattern></defs>' +
        '<path d="' + d + '" fill="' + color + '" stroke="' + color + '" stroke-width="6" stroke-linejoin="round"/>' +
        '<path d="' + d + '" fill="url(#' + id + ')"/>'
    );
  }

  /* A scrap of graph paper with a torn lower edge. */
  function graph() {
    var pid = nid("gp");
    var cid = nid("gc");
    var d = "M8 14 L186 4 L194 150 L132 162 L112 150 L52 176 L4 158 Z";
    return svg(
      "0 0 200 200",
      '<defs><clipPath id="' + cid + '"><path d="' + d + '"/></clipPath>' +
        '<pattern id="' + pid + '" width="16" height="16" patternUnits="userSpaceOnUse">' +
        '<path d="M16 0 H0 V16" fill="none" stroke="' + C.grid + '" stroke-width="1.3" opacity=".5"/></pattern></defs>' +
        '<path d="' + d + '" fill="' + C.ink + '" opacity=".09" transform="translate(4 5)"/>' +
        '<g clip-path="url(#' + cid + ')"><rect width="200" height="200" fill="' + C.paper + '"/>' +
        '<rect width="200" height="200" fill="url(#' + pid + ')"/></g>' +
        '<path d="' + d + '" fill="none" stroke="' + C.ink + '" stroke-opacity=".18" stroke-width="1.5" stroke-linejoin="round"/>'
    );
  }

  /* A starburst with n points. */
  function starburst(color, n, ro, ri) {
    var pts = [];
    var i, a, r;
    n = n || 14;
    ro = ro || 48;
    ri = ri || 37;
    for (i = 0; i < n * 2; i += 1) {
      a = (Math.PI * i) / n - Math.PI / 2;
      r = i % 2 ? ri : ro;
      pts.push((50 + r * Math.cos(a)).toFixed(1) + "," + (50 + r * Math.sin(a)).toFixed(1));
    }
    return svg(
      "0 0 100 100",
      '<polygon points="' + pts.join(" ") + '" fill="' + color + '" stroke="' + color + '" stroke-width="3" stroke-linejoin="round"/>'
    );
  }

  /* A little 4-point sparkle. */
  function sparkle(color) {
    return svg(
      "0 0 100 100",
      '<path d="M50 0 C54 30 70 46 100 50 C70 54 54 70 50 100 C46 70 30 54 0 50 C30 46 46 30 50 0 Z" fill="' + (color || C.lilac) + '"/>'
    );
  }

  /* A yellow brush stroke. */
  function brush(color) {
    return svg(
      "0 0 250 70",
      '<path d="M6 40 C40 10 90 52 140 28 S220 18 244 34 L240 52 C200 44 170 64 130 56 S50 70 10 60 Z" fill="' + (color || C.butter) + '"/>' +
        '<path d="M30 30 C60 22 100 40 150 26" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>'
    );
  }

  /* A neon squiggle that stretches to the width of what it sits under. */
  function squiggle(color) {
    return svg(
      "0 0 100 12",
      '<path d="M3 7 Q11 0 19 7 T35 7 T51 7 T67 7 T83 7 T97 7" fill="none" stroke="' + (color || C.pink) +
        '" stroke-width="4.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>',
      ' preserveAspectRatio="none"'
    );
  }

  /* A chunky hand-drawn arrow, pointing down and to the right. */
  function arrow(color) {
    var shaft = "M12 6 C40 2 66 28 58 66";
    var head = "M42 54 L58 74 L72 52";
    return svg(
      "0 0 84 88",
      '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="' + shaft + " " + head + '" stroke="' + C.ink + '" stroke-width="10"/>' +
        '<path d="' + shaft + " " + head + '" stroke="' + (color || C.lime) + '" stroke-width="5"/></g>'
    );
  }

  /* A small pencil for the progress line. It points right. */
  function pencil() {
    return svg(
      "0 0 44 22",
      '<path d="M2 4 H27 V18 H2 Z" fill="' + C.butter + '" stroke="' + C.ink + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M2 4 H8 V18 H2 Z" fill="' + C.pink + '" stroke="' + C.ink + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M27 4 L40 11 L27 18 Z" fill="' + C.pinkSoft + '" stroke="' + C.ink + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M36.5 9.2 L40 11 L36.5 12.8 Z" fill="' + C.ink + '"/>'
    );
  }

  /* A little cat doodle: the stand-in on the landing page until the live sample is ready. */
  function cat() {
    return svg(
      "0 0 120 110",
      '<g fill="' + C.paper + '" stroke="' + C.ink + '" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M34 50 L29 20 L52 38 Z"/><path d="M86 50 L91 20 L68 38 Z"/>' +
        '<path d="M30 78 C23 50 40 34 60 36 C80 34 97 50 90 78 C86 99 34 99 30 78 Z"/></g>' +
        '<g fill="' + C.ink + '"><circle cx="47" cy="64" r="3.6"/><circle cx="73" cy="64" r="3.6"/></g>' +
        '<path d="M56.5 72 L63.5 72 L60 76.5 Z" fill="' + C.pink + '" stroke="' + C.ink + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<g fill="none" stroke="' + C.ink + '" stroke-width="3" stroke-linecap="round">' +
        '<path d="M60 76.5 Q55 84 49 79 M60 76.5 Q65 84 71 79"/>' +
        '<path d="M31 72 L12 67 M31 79 L13 82 M89 72 L108 67 M89 79 L107 82"/></g>' +
        '<g fill="' + C.pinkSoft + '"><ellipse cx="40" cy="74" rx="5" ry="3.2"/><ellipse cx="80" cy="74" rx="5" ry="3.2"/></g>'
    );
  }

  /* A puzzled crumpled-paper face for the error screens. */
  function sad() {
    return svg(
      "0 0 120 110",
      '<path d="M20 24 L48 14 L74 20 L100 12 L108 40 L100 64 L110 90 L78 98 L52 90 L22 98 L12 70 L18 46 Z" ' +
        'fill="' + C.paper + '" stroke="' + C.ink + '" stroke-width="3.2" stroke-linejoin="round"/>' +
        '<g fill="' + C.ink + '"><circle cx="46" cy="50" r="4"/><circle cx="76" cy="50" r="4"/></g>' +
        '<path d="M48 76 Q61 65 75 76" fill="none" stroke="' + C.ink + '" stroke-width="3.2" stroke-linecap="round"/>' +
        '<path d="M82 56 C78 62 78 66 82 66 C86 66 86 62 82 56 Z" fill="' + C.cyan + '" stroke="' + C.ink + '" stroke-width="1.6"/>' +
        '<path d="M92 14 C98 3 113 8 108 19 C106 25 98 25 98 33" fill="none" stroke="' + C.pink + '" stroke-width="4" stroke-linecap="round"/>' +
        '<circle cx="98" cy="42" r="2.6" fill="' + C.pink + '"/>'
    );
  }

  var ICONS = {
    camera:
      '<svg viewBox="0 0 28 28" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M3.5 9.5h4l2-3h9l2 3h4v12.5h-21z"/><circle cx="14" cy="15.5" r="4.2"/></svg>',
    back:
      '<svg viewBox="0 0 28 28" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M18 5 L9 14 L18 23"/></svg>',
    share:
      '<svg viewBox="0 0 28 28" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M14 3.5 V17 M8.5 8.8 L14 3.5 L19.5 8.8 M9 12 H6.5 a1.5 1.5 0 0 0 -1.5 1.5 V23 a1.5 1.5 0 0 0 1.5 1.5 H21.5 a1.5 1.5 0 0 0 1.5 -1.5 V13.5 a1.5 1.5 0 0 0 -1.5 -1.5 H19"/></svg>',
    save:
      '<svg viewBox="0 0 28 28" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M14 4 V17 M8.5 12 L14 17.5 L19.5 12 M5 22.5 H23"/></svg>',
    film:
      '<svg viewBox="0 0 28 28" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<rect x="4" y="5" width="20" height="18" rx="3"/><path d="M11.5 10.5 L17.5 14 L11.5 17.5 Z"/></svg>',
    text:
      '<svg viewBox="0 0 28 28" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M5 8 V5.5 H23 V8 M14 5.5 V23 M10 23 H18"/></svg>'
  };

  /* ---------- compositions ---------- */

  function item(inner, cls, style) {
    return '<span class="d ' + (cls || "") + '" style="' + style + '">' + inner + "</span>";
  }

  var COMPS = {
    /* Page corners on the landing screen. The wordmark sits top left, so the top right gets the paper. */
    "page-landing": function () {
      return (
        item(torn(C.periwinkle, 0), "d-drift", "top:-50px;right:-66px;width:200px;--r:14deg") +
        item(starburst(C.pink, 14, 48, 37), "d-spin", "bottom:-40px;left:-44px;width:124px;--r:0deg") +
        item(sparkle(C.lilac), "d-twinkle", "top:118px;right:20px;width:26px") +
        item(sparkle(C.butter), "d-twinkle d-slow", "bottom:150px;right:16px;width:20px")
      );
    },
    /* Around the hero card: hugs the sides, never the middle. */
    hero: function () {
      return (
        item(graph(), "", "left:1%;top:4%;width:24%;--r:-8deg") +
        item(starburst(C.butter, 14, 48, 36), "d-spin", "left:-8%;top:54%;width:28%") +
        item(torn(C.pink, 1), "", "right:-9%;top:20%;width:30%;--r:10deg") +
        item(sparkle(C.lilac), "d-twinkle", "right:5%;top:2%;width:9%") +
        item(sparkle(C.pink), "d-twinkle d-slow", "left:6%;top:84%;width:8%") +
        item(torn(C.periwinkle, 2), "", "right:-13%;bottom:-6%;width:28%;--r:-12deg") +
        item(brush(C.butter), "", "left:-4%;bottom:2%;width:26%;--r:-14deg")
      );
    },
    /* The side gutters beside the story preview in the editor. */
    stage: function () {
      return (
        item(starburst(C.butter, 14, 48, 36), "d-spin", "left:-2%;bottom:5%;width:15%") +
        item(sparkle(C.pink), "d-twinkle", "right:4%;top:8%;width:7%") +
        item(torn(C.lilac, 0), "", "right:-8%;bottom:4%;width:22%;--r:20deg") +
        item(sparkle(C.lilac), "d-twinkle d-slow", "left:4%;top:64%;width:6%")
      );
    },
    work: function () {
      return (
        item(torn(C.periwinkle, 1), "d-drift", "top:-40px;left:-56px;width:170px;--r:-10deg") +
        item(starburst(C.butter, 12, 48, 36), "d-spin", "bottom:-30px;right:-34px;width:120px") +
        item(sparkle(C.pink), "d-twinkle", "top:90px;right:28px;width:26px") +
        item(sparkle(C.lilac), "d-twinkle d-slow", "bottom:140px;left:26px;width:22px")
      );
    },
    error: function () {
      return (
        item(torn(C.pink, 2), "d-drift", "top:-50px;right:-60px;width:180px;--r:16deg") +
        item(graph(), "", "bottom:90px;left:-34px;width:120px;--r:-10deg") +
        item(sparkle(C.lilac), "d-twinkle", "top:110px;left:24px;width:26px") +
        item(starburst(C.butter, 14, 48, 36), "d-spin", "bottom:-36px;right:-30px;width:110px")
      );
    },
    "hero-fallback": function () {
      return (
        item(torn(C.periwinkle, 1), "", "left:-14%;top:-8%;width:76%;--r:8deg") +
        item(torn(C.pink, 2), "", "right:-16%;bottom:-6%;width:78%;--r:-6deg") +
        item(starburst(C.butter, 14, 48, 36), "d-spin", "right:6%;top:6%;width:26%") +
        item(sparkle(C.paper), "d-twinkle", "left:10%;bottom:12%;width:12%") +
        item(cat(), "fb-cat", "left:16%;top:36%;width:68%")
      );
    }
  };

  function mount(root) {
    var nodes = (root || document).querySelectorAll("[data-decor]");
    Array.prototype.forEach.call(nodes, function (el) {
      var make = COMPS[el.getAttribute("data-decor")];
      if (make && !el.firstChild) el.innerHTML = make();
    });
  }

  DA.decor = {
    colors: C,
    mount: mount,
    torn: torn,
    graph: graph,
    starburst: starburst,
    sparkle: sparkle,
    brush: brush,
    squiggle: squiggle,
    arrow: arrow,
    pencil: pencil,
    cat: cat,
    sad: sad,
    icon: function (name) {
      return ICONS[name] || "";
    }
  };
})();
