(function () {
  'use strict';

  window.createCountryStoriesStore = function () {
    var listeners = [];
    var pending = null;
    var currentState = 'loading';
    var payload = null;

    function notify() {
      listeners.forEach(function (listener) { listener(currentState, payload); });
    }

    return {
      subscribe: function (listener) {
        listeners.push(listener);
        listener(currentState, payload);
      },
      load: function () {
        if (pending) return pending;
        currentState = 'loading';
        notify();
        pending = fetch('./data/facial-recognition-stories.json')
          .then(function (response) {
            if (!response.ok) throw new Error('Failed to load country stories');
            return response.json();
          })
          .then(function (snapshot) {
            payload = snapshot;
            currentState = 'ready';
            notify();
          })
          .catch(function (error) {
            currentState = 'error';
            notify();
            console.warn('Could not load country stories:', error);
          })
          .finally(function () { pending = null; });
        return pending;
      }
    };
  };

  window.createCountryStoriesFeature = function (section, options) {
    var featureOptions = options || {};
    var store = featureOptions.store || window.createCountryStoriesStore();
    var regionView = !!featureOptions.regionView;
    var title = section.querySelector('[data-stories-title]');
    var status = section.querySelector('[data-stories-status]');
    var cards = section.querySelector('[data-stories-cards]');
    var contributionCopy = section.querySelector('.contribution-hero p');
    var defaultContributionCopy = contributionCopy ? contributionCopy.textContent : '';
    var retryButton = section.querySelector('[data-stories-retry]');
    var storiesByCountry = new Map();
    var selectedCountry = null;
    var selectedRegion = null;
    var selectedYear = null;
    var loadState = 'loading';
    var renderedIDs = null;

    function safeUrl(value) {
      try {
        var url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
      } catch (error) {
        return null;
      }
    }

    function element(tag, text, className) {
      var node = document.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      return node;
    }

    function link(text, href, className) {
      var anchor = element('a', text, className);
      anchor.href = safeUrl(href);
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      return anchor;
    }

    function createCard(story) {
      var card = element('article', '', 'country-story');
      card.dataset.storyId = story.id;
      var heading = element('h3', story.title);
      var date = element('time', new Date(story.date + 'T12:00:00Z').toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
      }));
      date.dateTime = story.date;
      card.append(heading, date);
      story.paragraphs.forEach(function (paragraph) {
        card.appendChild(element('p', paragraph));
      });
      var actions = element('div', '', 'country-story-actions');
      story.articleLinks.forEach(function (articleLink, index) {
        var label = /^link to article\b/i.test(articleLink.label) ? articleLink.label : 'Link to article';
        if (story.articleLinks.length > 1) label += ' ' + (index + 1);
        var articleAnchor = link(label, articleLink.url, 'country-story-button');
        articleAnchor.setAttribute('aria-label', label + ': ' + story.title);
        articleAnchor.title = articleLink.label || label;
        actions.appendChild(articleAnchor);
      });
      card.appendChild(actions);
      return card;
    }

    function render() {
      if (!selectedCountry) return;
      if (!regionView) section.parentElement.classList.add('has-selected-country');
      section.hidden = false;
      title.hidden = false;
      var subjectName = selectedRegion ? selectedRegion.name : selectedCountry.name;
      title.textContent = 'Stories from ' + subjectName;
      retryButton.hidden = loadState !== 'error';
      var allStories = storiesByCountry.get(selectedCountry.id) || [];
      if (selectedRegion) {
        allStories = allStories.filter(function (story) {
          return (story.regionIDs || []).includes(selectedRegion.id);
        });
      }
      if (contributionCopy) contributionCopy.textContent = loadState === 'ready' && !allStories.length
        ? "We don't have any examples of facial recognition being used in education for this country yet. If you know of any that are not yet on this list, please let us know and help us expand this map."
        : defaultContributionCopy;
      var visibleStories = loadState === 'ready' ? allStories.filter(function (story) {
        return selectedYear === null || Number(story.date.slice(0, 4)) <= selectedYear;
      }) : [];
      var message;
      if (loadState === 'loading') {
        message = 'Loading stories...';
      } else if (loadState === 'error') {
        message = 'Stories could not be loaded. The map is still available.';
      } else if (!allStories.length) {
        message = selectedRegion
          ? 'No stories have been tagged for ' + subjectName + ' yet.'
          : 'No facial-recognition-tagged stories are recorded for ' + subjectName + '.';
      } else if (!visibleStories.length) {
        message = 'No facial-recognition-tagged stories are recorded for ' + subjectName + ' through ' + selectedYear + '.';
      } else {
        message = visibleStories.length + (visibleStories.length === 1 ? ' story' : ' stories') +
          (selectedYear === null ? '' : ' through ' + selectedYear) + '.';
      }
          status.hidden = !regionView && loadState === 'ready' && !allStories.length;
      if (status.textContent !== message) status.textContent = message;
      var nextIDs = selectedCountry.id + ':' + (selectedRegion ? selectedRegion.id : '') + ':' + visibleStories.map(function (story) { return story.id; }).join(',');
      if (renderedIDs !== nextIDs) {
        if (window.Vue) {
          var countryID = selectedCountry.id;
          window.Vue.render(window.Vue.h(window.Vue.TransitionGroup, {
            name: 'fade', tag: 'div', class: 'country-story-list', appear: true
          }, {
            default: function () {
              return visibleStories.map(function (story) {
                return window.Vue.h('div', {
                  key: countryID + ':' + story.id,
                  class: 'country-story-transition',
                  ref: function (node) {
                    if (node && !node.firstChild) node.appendChild(createCard(story));
                  }
                });
              });
            }
          }), cards);
        } else {
          cards.replaceChildren.apply(cards, visibleStories.map(createCard));
        }
        renderedIDs = nextIDs;
      }
    }

    function validateStory(story) {
      if (!story || typeof story.id !== 'string' || typeof story.title !== 'string' || !story.title ||
          !/^\d{4}-\d{2}-\d{2}$/.test(story.date) ||
          Number.isNaN(Date.parse(story.date)) || new Date(story.date).toISOString().slice(0, 10) !== story.date ||
          !safeUrl(story.sourceUrl) || !Array.isArray(story.countryIDs) ||
          !story.countryIDs.every(function (countryID) { return /^[A-Z]{2}$/.test(countryID); }) ||
          (story.regionIDs !== undefined && (!Array.isArray(story.regionIDs) ||
            !story.regionIDs.every(function (regionID) {
              return typeof regionID === 'string' && /^[A-Z]{2}-[A-Z0-9]+$/.test(regionID) &&
                story.countryIDs.includes(regionID.slice(0, 2));
            }))) ||
          !Array.isArray(story.paragraphs) || !story.paragraphs.length ||
          !story.paragraphs.every(function (paragraph) { return typeof paragraph === 'string'; }) ||
          !Array.isArray(story.articleLinks) || !story.articleLinks.every(function (articleLink) {
            return articleLink && typeof articleLink.label === 'string' && safeUrl(articleLink.url);
          })) {
        throw new Error('Invalid story in country story snapshot');
      }
    }

    store.subscribe(function (nextState, payload) {
      loadState = nextState;
      if (loadState === 'ready') {
          if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.stories) || !payload.stories.length) {
            throw new Error('Invalid country story snapshot');
          }
          var index = new Map();
          var seen = new Set();
          payload.stories.forEach(function (story) {
            validateStory(story);
            if (seen.has(story.id)) throw new Error('Duplicate story ID');
            seen.add(story.id);
            Array.from(new Set(story.countryIDs)).forEach(function (countryID) {
              if (!index.has(countryID)) index.set(countryID, []);
              index.get(countryID).push(story);
            });
          });
          index.forEach(function (stories) {
            stories.sort(function (first, second) {
              return second.date.localeCompare(first.date) || first.id.localeCompare(second.id);
            });
          });
          storiesByCountry = index;
      }
      render();
    });

    retryButton.addEventListener('click', store.load);
    return {
      load: store.load,
      clearSelection: function () {
        selectedCountry = null;
        selectedRegion = null;
        if (regionView) {
          title.hidden = true;
          status.hidden = false;
          status.textContent = 'No state selected.';
          retryButton.hidden = true;
          cards.replaceChildren();
          renderedIDs = null;
        } else {
          section.hidden = true;
          section.parentElement.classList.remove('has-selected-country');
        }
      },
      selectCountry: function (countryID, countryName) {
        var countryChanged = !selectedCountry || selectedCountry.id !== countryID;
        selectedCountry = { id: countryID, name: countryName };
        selectedRegion = null;
        render();
        if (countryChanged) section.scrollTop = 0;
      },
      selectRegion: function (countryID, regionID, regionName) {
        var regionChanged = !selectedRegion || selectedRegion.id !== regionID;
        selectedCountry = { id: countryID, name: countryID };
        selectedRegion = { id: regionID, name: regionName };
        render();
        if (regionChanged) section.scrollTop = 0;
      },
      setYear: function (year) {
        selectedYear = Number.isInteger(year) ? year : null;
        render();
      }
    };
  };
}());