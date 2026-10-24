/* =====================================================================
 * CUVA Portal — browser data layer (api.js)
 * ---------------------------------------------------------------------
 * Every read/write goes to the server (/api/*), which stores it in the
 * shared database (server/database.js). Nothing is kept in the browser
 * except the login cookie.
 * ===================================================================== */
const API = (() => {
  'use strict';

  class ApiError extends Error {
    constructor(message, status, code, data) {
      super(message);
      this.status = status;
      this.code = code;
      this.data = data || {};
    }
  }

  async function request(method, url, body) {
    const options = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, options);
    } catch {
      throw new ApiError('Network error. Check your connection and try again.', 0, 'NETWORK');
    }

    let data = {};
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }

    if (!res.ok) {
      throw new ApiError(data.error || `Request failed (${res.status}).`, res.status, data.code, data);
    }
    return data;
  }

  const get = url => request('GET', url);
  const post = (url, body = {}) => request('POST', url, body);
  const put = (url, body) => request('PUT', url, body);
  const patch = (url, body) => request('PATCH', url, body);
  const del = url => request('DELETE', url);

  // Relative URLs so the site also works when hosted under a sub-path (e.g. /cuva/)
  return {
    ApiError,

    // session & auth
    session:  () => get('api/session'),
    signUp:   data => post('api/auth/signup', data),
    signIn:   (studentId, password) => post('api/auth/signin', { studentId, password }),
    signOut:  () => post('api/auth/signout'),

    // public
    events:     () => get('api/events'),
    categories: () => get('api/categories'),

    // student
    myRegistrations: () => get('api/me/registrations'),
    register:        eventId => post(`api/events/${encodeURIComponent(eventId)}/register`),

    // organizer: activities
    createEvent: data => post('api/events', data),
    updateEvent: (id, data) => put(`api/events/${encodeURIComponent(id)}`, data),
    deleteEvent: id => del(`api/events/${encodeURIComponent(id)}`),

    // organizer: categories
    addCategory:    name => post('api/categories', { name }),
    renameCategory: (id, name) => put(`api/categories/${encodeURIComponent(id)}`, { name }),
    deleteCategory: id => del(`api/categories/${encodeURIComponent(id)}`),

    // organizer: roster & door
    roster: eventId => get(`api/admin/registrations${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`),
    setRegistrationStatus: (id, status, eventId, studentId) => patch(`api/admin/registrations/${encodeURIComponent(id)}`, { status, eventId, studentId }),
    checkIn: (token, eventId) => post('api/admin/checkin', eventId ? { token, eventId } : { token }),

    // super admin
    organizers:      () => get('api/admin/organizers'),
    addOrganizer:    studentId => post('api/admin/organizers', { studentId }),
    removeOrganizer: studentId => del(`api/admin/organizers/${encodeURIComponent(studentId)}`)
  };
})();
