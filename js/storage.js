/**
 * 栖思 · 笔记整理工具 — 存储层
 * 封装 localStorage 读写 + 埋点模块
 */
var Storage = (function() {
  'use strict';

  // ===== 底层封装 =====
  function _get(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[Storage] 读取失败:', key, e);
      return null;
    }
  }

  function _set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('[Storage] 写入失败:', key, e);
    }
  }

  function _remove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  // ===== 键名常量 =====
  var KEYS = {
    CHAT_STATE: 'qisi3-chat-state',
    ECHOES: 'qisi3-echoes',
    PROFILE: 'qisi3-profile',
    ONBOARDED: 'qisi3-onboarded',
    THEME: 'qisi3-theme',
    ANALYTICS: 'qisi3-analytics',
    TRASH: 'qisi3-trash',
    CUSTOM_DOMAINS: 'qisi3-custom-domains',
    CARD_NOTES: 'qisi3-card-notes',
    NOTES: 'qisi3-notes',
    ORGANIZE_SESSION: 'qisi3-organize-session',
    REVIEWS: 'qisi3-reviews',
  };

  // ========================================================
  //  ChatState — 对话状态（整理会话 / 复盘会话）
  // ========================================================
  var ChatState = {
    save: function(state) { _set(KEYS.CHAT_STATE, state); },
    load: function() { return _get(KEYS.CHAT_STATE); },
    clear: function() { _remove(KEYS.CHAT_STATE); },
  };

  // ========================================================
  //  Echoes — 知识点卡片
  // ========================================================
  var Echoes = {
    load: function() { return _get(KEYS.ECHOES) || []; },
    save: function(arr) { _set(KEYS.ECHOES, arr); },
    add: function(card) {
      var arr = Echoes.load();
      arr.push(card);
      Echoes.save(arr);
      return card;
    },
    addMany: function(cards) {
      var arr = Echoes.load();
      cards.forEach(function(c) { arr.push(c); });
      Echoes.save(arr);
    },
  };

  // ========================================================
  //  Profile — 用户画像（Onboarding数据）
  // ========================================================
  var Profile = {
    load: function() {
      return _get(KEYS.PROFILE) || {
        nickname: '',
        defaultPurpose: '考前复习',
      };
    },
    save: function(profile) { _set(KEYS.PROFILE, profile); },
    update: function(key, value) {
      var p = Profile.load();
      p[key] = value;
      Profile.save(p);
      return p;
    },
  };

  // ========================================================
  //  Onboarding — 引导流程
  // ========================================================
  var Onboarding = {
    isDone: function() {
      try { return localStorage.getItem(KEYS.ONBOARDED) === 'true'; } catch (e) { return false; }
    },
    markDone: function() {
      try { localStorage.setItem(KEYS.ONBOARDED, 'true'); } catch (e) {}
    },
    reset: function() { _remove(KEYS.ONBOARDED); },
  };

  // ========================================================
  //  Theme — 主题
  // ========================================================
  var Theme = {
    get: function() {
      try { return localStorage.getItem(KEYS.THEME) || ''; } catch (e) { return ''; }
    },
    set: function(cls) {
      try { localStorage.setItem(KEYS.THEME, cls); } catch (e) {}
    },
  };

  // ========================================================
  //  Notes — 整理产出的笔记实体
  // ========================================================
  var Notes = {
    load: function() { return _get(KEYS.NOTES) || []; },
    save: function(arr) { _set(KEYS.NOTES, arr); },

    add: function(note) {
      var arr = Notes.load();
      arr.push(note);
      Notes.save(arr);
      return note;
    },

    get: function(id) {
      var arr = Notes.load();
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id) return arr[i];
      }
      return null;
    },

    update: function(id, patch) {
      var arr = Notes.load();
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id) {
          Object.assign(arr[i], patch);
          Notes.save(arr);
          return arr[i];
        }
      }
      return null;
    },

    remove: function(id) {
      var arr = Notes.load().filter(function(n) { return n.id !== id; });
      Notes.save(arr);
    },

    // 笔记总数
    count: function() { return Notes.load().length; },
  };

  // ========================================================
  //  OrganizeSession — 进行中的整理会话（刷新恢复用）
  //  { active, stage, plan, sourceText, sourceMeta }
  // ========================================================
  var OrganizeSession = {
    save: function(session) { _set(KEYS.ORGANIZE_SESSION, session); },
    load: function() { return _get(KEYS.ORGANIZE_SESSION); },
    clear: function() { _remove(KEYS.ORGANIZE_SESSION); },
  };

  // ========================================================
  //  Reviews — 复盘记录（按笔记ID分组）
  //  { noteId: { history: [{role, content}], reviewCount, lastReviewedAt } }
  // ========================================================
  var Reviews = {
    _all: function() { return _get(KEYS.REVIEWS) || {}; },
    _save: function(all) { _set(KEYS.REVIEWS, all); },

    get: function(noteId) {
      var all = Reviews._all();
      return all[noteId] || { history: [], reviewCount: 0, lastReviewedAt: null };
    },

    saveHistory: function(noteId, history) {
      var all = Reviews._all();
      var rec = all[noteId] || { history: [], reviewCount: 0, lastReviewedAt: null };
      rec.history = history;
      all[noteId] = rec;
      Reviews._save(all);
    },

    recordReview: function(noteId) {
      var all = Reviews._all();
      var rec = all[noteId] || { history: [], reviewCount: 0, lastReviewedAt: null };
      rec.reviewCount = (rec.reviewCount || 0) + 1;
      rec.lastReviewedAt = Date.now();
      all[noteId] = rec;
      Reviews._save(all);
      return rec.reviewCount;
    },

    getHistory: function(noteId) { return Reviews.get(noteId).history; },

    // 全部复盘总次数（统计用）
    totalCount: function() {
      var all = Reviews._all();
      var total = 0;
      Object.keys(all).forEach(function(k) { total += (all[k].reviewCount || 0); });
      return total;
    },
  };

  // ========================================================
  //  Trash — 垃圾箱（已删除卡片/笔记，7天后自动清空）
  // ========================================================
  var Trash = {
    load: function() { return _get(KEYS.TRASH) || []; },

    add: function(item) {
      var arr = Trash.load();
      var trashed = Object.assign({}, item, { deletedAt: Date.now(), itemType: item.itemType || 'card' });
      arr.push(trashed);
      arr = Trash._purgeOld(arr);
      _set(KEYS.TRASH, arr);
      return trashed;
    },

    addMany: function(items) {
      var arr = Trash.load();
      var now = Date.now();
      items.forEach(function(item) {
        arr.push(Object.assign({}, item, { deletedAt: now, itemType: item.itemType || 'card' }));
      });
      arr = Trash._purgeOld(arr);
      _set(KEYS.TRASH, arr);
    },

    restore: function(id) {
      var arr = Trash.load();
      var item = null;
      var rest = [];
      arr.forEach(function(c) {
        if (c.id === id) { item = c; } else { rest.push(c); }
      });
      _set(KEYS.TRASH, rest);
      if (item) {
        delete item.deletedAt;
        return item;
      }
      return null;
    },

    permanentDelete: function(id) {
      var arr = Trash.load().filter(function(c) { return c.id !== id; });
      _set(KEYS.TRASH, arr);
    },

    _purgeOld: function(arr) {
      var cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return arr.filter(function(c) { return (c.deletedAt || 0) > cutoff; });
    },

    loadPurged: function() {
      var arr = Trash.load();
      var purged = Trash._purgeOld(arr);
      if (purged.length !== arr.length) _set(KEYS.TRASH, purged);
      return purged;
    },
  };

  // ========================================================
  //  CustomDomains — 用户自定义领域（知识点分类）
  // ========================================================
  var CustomDomains = {
    load: function() { return _get(KEYS.CUSTOM_DOMAINS) || []; },
    save: function(arr) { _set(KEYS.CUSTOM_DOMAINS, arr); },
    add: function(name) {
      var list = CustomDomains.load();
      if (name && list.indexOf(name) < 0) { list.push(name); CustomDomains.save(list); }
      return list;
    },
    remove: function(name) {
      var list = CustomDomains.load().filter(function(d) { return d !== name; });
      CustomDomains.save(list);
      return list;
    },
  };

  // ========================================================
  //  CardNotes — 卡片上的用户笔记（按卡片ID存储）
  // ========================================================
  var CardNotes = {
    get: function(cardId) {
      var all = _get(KEYS.CARD_NOTES) || {};
      return all[cardId] || '';
    },
    save: function(cardId, note) {
      var all = _get(KEYS.CARD_NOTES) || {};
      if (note && note.trim()) {
        all[cardId] = note.trim();
      } else {
        delete all[cardId];
      }
      _set(KEYS.CARD_NOTES, all);
    },
    remove: function(cardId) {
      var all = _get(KEYS.CARD_NOTES) || {};
      delete all[cardId];
      _set(KEYS.CARD_NOTES, all);
    },
    loadAll: function() { return _get(KEYS.CARD_NOTES) || {}; },
  };

  // ========================================================
  //  Analytics — 埋点模块
  // ========================================================
  var Analytics = {
    track: function(eventId, data) {
      var events = _get(KEYS.ANALYTICS) || [];
      events.push({
        id: eventId,
        data: data || {},
        ts: Date.now(),
        date: new Date().toISOString().split('T')[0],
      });
      if (events.length > 1000) events = events.slice(-1000);
      _set(KEYS.ANALYTICS, events);
    },

    getEvents: function(filter) {
      var events = _get(KEYS.ANALYTICS) || [];
      if (filter && filter.id) {
        events = events.filter(function(e) { return e.id === filter.id; });
      }
      return events;
    },

    getSummary: function() {
      var events = _get(KEYS.ANALYTICS) || [];
      var imports = events.filter(function(e) { return e.id === 'import'; });
      var generated = events.filter(function(e) { return e.id === 'note_generated'; });
      var reviews = events.filter(function(e) { return e.id === 'review_start'; });
      return {
        totalImports: imports.length,
        totalNotes: generated.length,
        totalReviews: reviews.length,
      };
    },

    clear: function() { _remove(KEYS.ANALYTICS); },
  };

  // ========================================================
  //  公开 API
  // ========================================================
  return {
    KEYS: KEYS,
    ChatState: ChatState,
    Echoes: Echoes,
    Profile: Profile,
    Onboarding: Onboarding,
    Theme: Theme,
    Analytics: Analytics,
    Trash: Trash,
    CustomDomains: CustomDomains,
    CardNotes: CardNotes,
    Notes: Notes,
    OrganizeSession: OrganizeSession,
    Reviews: Reviews,
  };
})();
