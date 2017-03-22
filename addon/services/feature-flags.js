import Ember from 'ember';
import request from 'ember-ajax/request';
import FeatureFlag from 'ember-api-feature-flags/feature-flag';
import pick from 'ember-api-feature-flags/utils/pick';

const {
  String: { camelize },
  RSVP: { resolve },
  Service,
  computed,
  assert,
  get,
  set,
  isPresent,
  setProperties,
  typeOf
} = Ember;
const SERVICE_OPTIONS = [
  'featureUrl',
  'featureKey',
  'enabledKey',
  'shouldMemoize',
  'defaultValue'
];

export default Service.extend({
  /**
   * Boolean status reflecting success or failure of fetching data.
   *
   * @public
   * @property {Boolean}
   */
  didFetchData: false,

  /**
   * Raw response from API.
   *
   * @private
   * @property {Object|Null}
   */
  _data: null,

  /**
   * Memoized cache of FeatureFlag objects.
   *
   * @private
   * @property {Object}
   */
  _cache: {},

  /**
   * Test mode status.
   *
   * @private
   * @property {Boolean}
   */
  __testing__: false,

  /**
   * Set options on the FeatureFlags service.
   *
   * @public
   * @chainable
   * @param {Object} options
   * @returns {this}
   */
  configure(options) {
    assert(`[ember-api-feature-flags] Cannot configure FeatureFlags service without options`, isPresent(options));
    setProperties(this, pick(options, SERVICE_OPTIONS));
    return this;
  },

  /**
   * Normalized data from API.
   *
   * @public
   * @returns {Object|Boolean}
   */
  data: computed('didFetchData', '_data', function() {
    return get(this, 'didFetchData') && this._normalizeData(get(this, '_data'));
  }).readOnly(),
  /**

  /**
   * Fetch features from endpoint specified in config/environment.
   *
   * @public
   * @async
   * @param {String} [url=get(this, 'featureUrl')]
   * @returns {Promise}
   */
  fetchFeatures(url = get(this, 'featureUrl')) {
    if (get(this, '__testing__')) {
      return resolve(true);
    }
    return request(url);
  },

  /**
   * Receive data from API and set internal properties. If data is blank, we
   * set the service in error mode.
   *
   * @public
   * @param {Any} data
   * @returns {Any}
   */
  receiveData(data) {
    let isValid = this._validateData(data);
    if (!isValid) {
      return this.receiveError('Empty data received');
    }
    return setProperties(this, { _data: data, didFetchData: true });
  },

  /**
   * Set service in errored state. Records failure reason as a side effect.
   *
   * @public
   * @param {Any} reason
   * @returns {Boolean}
   */
  receiveError(reason) {
    set(this, 'error', reason);
    return set(this, 'didFetchData', false);
  },

  /**
   * Normalizes a key with a function. Defaults to camelCase.
   *
   * @public
   * @param {String} [key='']
   * @returns {String}
   */
  normalizeKey(key = '') {
    return camelize(key);
  },

  /**
   * Allows proxying `get` to FeatureFlag objects. For example:
   *
   * ```js
   * let service = get(this, 'featureFlags);
   * service.get('myFeatureName.isEnabled);
   * ```
   *
   * @public
   * @param {String} key
   * @returns {FeatureFlag}
   */
  unknownProperty(key) {
    if (SERVICE_OPTIONS.includes(key)) {
      return this[key];
    }
    let keyForFeature = this.normalizeKey(key);
    let didFetchData = get(this, 'didFetchData');
    let isTesting = get(this, '__testing__');
    if (isTesting) {
      return this._handleTest();
    }
    if (didFetchData) {
      return this._handleSuccess(keyForFeature);
    }
    return this._handleFailed(keyForFeature);
  },

  /**
   * Stop holding references to cached FeatureFlags.
   *
   * @public
   * @returns {Void}
   */
  willDestroy() {
    this._super(...arguments);
    delete this._cache;
  },

  /**
   * Sets the service in testing mode.
   *
   * @public
   * @returns {Void}
   */
  setupForTesting() {
    setProperties(this, {
      __testing__: true,
      didFetchData: true,
      shouldMemoize: false
    });
  },

  /**
   * Validates data received from API.
   *
   * @private
   * @param {Array} data
   * @returns {Boolean}
   */
  _validateData(data) {
    return typeOf(data) === 'array' && get(data, 'length') > 0;
  },

  /**
   * When in testing mode, we set all features to be enabled by default.
   *
   * @public
   * @returns {FeatureFlag}
   */
  _handleTest() {
    return FeatureFlag.create({ isRelay: true, defaultValue: true });
  },

  /**
   * When data is present, return a FeatureFlag object for `key`. Also memoizes
   * by default.
   *
   * @private
   * @param {Any} key
   * @param {Boolean} [shouldMemoize=true]
   * @returns {FeatureFlag}
   */
  _handleSuccess(key, shouldMemoize = get(this, 'shouldMemoize')) {
    let data = get(this, 'data');
    let defaultValue = get(this, 'defaultValue');
    let featureFlag = FeatureFlag.create({ defaultValue, data: get(data, key) });
    return shouldMemoize ? this._memoize(key, featureFlag) : featureFlag;
  },

  /**
   * When no data is present, return a "relay" FeatureFlag object for `key`. A
   * relay is simply a proxy FeatureFlag object that holds no data.
   *
   * @private
   * @param {Any} key
   * @param {Boolean} [shouldMemoize=get(this, 'shouldMemoize')]
   * @returns {FeatureFlag}
   */
  _handleFailed(key, shouldMemoize = get(this, 'shouldMemoize')) {
    let defaultValue = get(this, 'defaultValue');
    let featureFlag = FeatureFlag.create({ defaultValue, isRelay: true });
    return shouldMemoize ? this._memoize(key, featureFlag) : featureFlag;
  },

  /**
   * Memoizes a feature flag lookup into the service's internal cache.
   *
   * @private
   * @param {String} key
   * @param {FeatureFlag} featureFlag
   * @param {Boolean} [shouldInvalidate=false]
   * @returns {FeatureFlag}
   */
  _memoize(key, featureFlag, shouldInvalidate = false) {
    let cache = get(this, '_cache');
    if (shouldInvalidate) {
      delete cache[key];
    }
    let found = cache[key];
    if (isPresent(found)) {
      return found;
    }
    cache[key] = featureFlag;
    return featureFlag;
  },

  /**
   * For a given data array, returns an object where the keys are the `featureKey`
   * values.
   *
   * @private
   * @param {Array<Object>} data
   * @param {String} [featureKey=get(this, 'featureKey')]
   * @returns {Object}
   */
  _normalizeData(data, featureKey = get(this, 'featureKey')) {
    return data.reduce((acc, d) => {
      let normalizedKey = this.normalizeKey(d[featureKey]);
      acc[normalizedKey] = pick(d, [get(this, 'enabledKey')]);
      return acc;
    }, {});
  }
});
