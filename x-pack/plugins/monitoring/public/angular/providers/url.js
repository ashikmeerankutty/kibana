/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import _ from 'lodash';

export function KbnUrlProvider($injector, $location, $rootScope, $parse) {
  /**
   *  the `kbnUrl` service was created to smooth over some of the
   *  inconsistent behavior that occurs when modifying the url via
   *  the `$location` api. In general it is recommended that you use
   *  the `kbnUrl` service any time you want to modify the url.
   *
   *  "features" that `kbnUrl` does it's best to guarantee, which
   *  are not guaranteed with the `$location` service:
   *   - calling `kbnUrl.change()` with a url that resolves to the current
   *     route will force a full transition (rather than just updating the
   *     properties of the $route object)
   *
   *  Additional features of `kbnUrl`
   *   - parameterized urls
   *   - easily include an app state with the url
   *
   *  @type {KbnUrl}
   */
  const self = this;

  /**
   * Navigate to a url
   *
   * @param  {String} url - the new url, can be a template. See #eval
   * @param  {Object} [paramObj] - optional set of parameters for the url template
   * @return {undefined}
   */
  self.change = function (url, paramObj, appState) {
    self._changeLocation('url', url, paramObj, false, appState);
  };

  /**
   * Same as #change except only changes the url's path,
   * leaving the search string and such intact
   *
   * @param  {String} path - the new path, can be a template. See #eval
   * @param  {Object} [paramObj] - optional set of parameters for the path template
   * @return {undefined}
   */
  self.changePath = function (path, paramObj) {
    self._changeLocation('path', path, paramObj);
  };

  /**
   * Same as #change except that it removes the current url from history
   *
   * @param  {String} url - the new url, can be a template. See #eval
   * @param  {Object} [paramObj] - optional set of parameters for the url template
   * @return {undefined}
   */
  self.redirect = function (url, paramObj, appState) {
    self._changeLocation('url', url, paramObj, true, appState);
  };

  /**
   * Same as #redirect except only changes the url's path,
   * leaving the search string and such intact
   *
   * @param  {String} path - the new path, can be a template. See #eval
   * @param  {Object} [paramObj] - optional set of parameters for the path template
   * @return {undefined}
   */
  self.redirectPath = function (path, paramObj) {
    self._changeLocation('path', path, paramObj, true);
  };

  /**
   * Evaluate a url template. templates can contain double-curly wrapped
   * expressions that are evaluated in the context of the paramObj
   *
   * @param  {String} template - the url template to evaluate
   * @param  {Object} [paramObj] - the variables to expose to the template
   * @return {String} - the evaluated result
   * @throws {Error} If any of the expressions can't be parsed.
   */
  self.eval = function (template, paramObj) {
    paramObj = paramObj || {};

    return template.replace(/\{\{([^\}]+)\}\}/g, function (match, expr) {
      // remove filters
      const key = expr.split('|')[0].trim();

      // verify that the expression can be evaluated
      const p = $parse(key)(paramObj);

      // if evaluation can't be made, throw
      if (_.isUndefined(p)) {
        throw new Error(`Replacement failed, unresolved expression: ${expr}`);
      }

      return encodeURIComponent($parse(expr)(paramObj));
    });
  };

  /**
   * convert an object's route to an href, compatible with
   * window.location.href= and <a href="">
   *
   * @param  {Object} obj - any object that list's it's routes at obj.routes{}
   * @param  {string} route - the route name
   * @return {string} - the computed href
   */
  self.getRouteHref = function (obj, route) {
    return '#' + self.getRouteUrl(obj, route);
  };

  /**
   * convert an object's route to a url, compatible with url.change() or $location.url()
   *
   * @param  {Object} obj - any object that list's it's routes at obj.routes{}
   * @param  {string} route - the route name
   * @return {string} - the computed url
   */
  self.getRouteUrl = function (obj, route) {
    const template = obj && obj.routes && obj.routes[route];
    if (template) return self.eval(template, obj);
  };

  /**
   * Similar to getRouteUrl, supports objects which list their routes,
   * and redirects to the named route. See #redirect
   *
   * @param  {Object} obj - any object that list's it's routes at obj.routes{}
   * @param  {string} route - the route name
   * @return {undefined}
   */
  self.redirectToRoute = function (obj, route) {
    self.redirect(self.getRouteUrl(obj, route));
  };

  /**
   * Similar to getRouteUrl, supports objects which list their routes,
   * and changes the url to the named route. See #change
   *
   * @param  {Object} obj - any object that list's it's routes at obj.routes{}
   * @param  {string} route - the route name
   * @return {undefined}
   */
  self.changeToRoute = function (obj, route) {
    self.change(self.getRouteUrl(obj, route));
  };

  /**
   * Removes the given parameter from the url. Does so without modifying the browser
   * history.
   * @param param
   */
  self.removeParam = function (param) {
    $location.search(param, null).replace();
  };

  /////
  // private api
  /////
  let reloading;

  self._changeLocation = function (type, url, paramObj, replace, appState) {
    const prev = {
      path: $location.path(),
      search: $location.search(),
    };

    url = self.eval(url, paramObj);
    $location[type](url);
    if (replace) $location.replace();

    if (appState) {
      $location.search(appState.getQueryParamName(), appState.toQueryParam());
    }

    const next = {
      path: $location.path(),
      search: $location.search(),
    };

    if ($injector.has('$route')) {
      const $route = $injector.get('$route');

      if (self._shouldForceReload(next, prev, $route)) {
        reloading = $rootScope.$on('$locationChangeSuccess', function () {
          // call the "unlisten" function returned by $on
          reloading();
          reloading = false;

          $route.reload();
        });
      }
    }
  };

  // determine if the router will automatically reload the route
  self._shouldForceReload = function (next, prev, $route) {
    if (reloading) return false;

    const route = $route.current && $route.current.$$route;
    if (!route) return false;

    // for the purposes of determining whether the router will
    // automatically be reloading, '' and '/' are equal
    const nextPath = next.path || '/';
    const prevPath = prev.path || '/';
    if (nextPath !== prevPath) return false;

    const reloadOnSearch = route.reloadOnSearch;
    const searchSame = _.isEqual(next.search, prev.search);
    return (reloadOnSearch && searchSame) || !reloadOnSearch;
  };
}
