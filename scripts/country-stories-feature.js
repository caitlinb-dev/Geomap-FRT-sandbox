(function () {
  'use strict';

  window.createCountryStoriesFeature = function (section) {
    var title = section.querySelector('[data-stories-title]');
    var status = section.querySelector('[data-stories-status]');
    var cards = section.querySelector('[data-stories-cards]');
    var retryButton = section.querySelector('[data-stories-retry]');
    var storiesByCountry = new Map();
    var selectedCountry = null;
    var selectedYear = null;
    var loadState = 'loading';
    var renderedIDs = null;
    var pendingLoad = null;

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
      section.parentElement.classList.add('has-selected-country');
      section.hidden = false;
      title.hidden = false;
      title.textContent = 'Stories from ' + selectedCountry.name;
      retryButton.hidden = loadState !== 'error';
      var allStories = storiesByCountry.get(selectedCountry.id) || [];
      var visibleStories = loadState === 'ready' ? allStories.filter(function (story) {
        return selectedYear === null || Number(story.date.slice(0, 4)) <= selectedYear;
      }) : [];
      var message;
      if (loadState === 'loading') {
        message = 'Loading stories...';
      } else if (loadState === 'error') {
        message = 'Stories could not be loaded. The map is still available.';
      } else if (!allStories.length) {
        message = 'No facial-recognition-tagged stories are recorded for ' + selectedCountry.name + '.';
      } else if (!visibleStories.length) {
        message = 'No facial-recognition-tagged stories are recorded for ' + selectedCountry.name + ' through ' + selectedYear + '.';
      } else {
        message = visibleStories.length + (visibleStories.length === 1 ? ' story' : ' stories') +
          (selectedYear === null ? '' : ' through ' + selectedYear) + '.';
      }
      if (status.textContent !== message) status.textContent = message;
      var nextIDs = selectedCountry.id + ':' + visibleStories.map(function (story) { return story.id; }).join(',');
      if (renderedIDs !== nextIDs) {
        cards.replaceChildren.apply(cards, visibleStories.map(createCard));
        renderedIDs = nextIDs;
      }
    }

    function validateStory(story) {
      if (!story || typeof story.id !== 'string' || typeof story.title !== 'string' || !story.title ||
          !/^\d{4}-\d{2}-\d{2}$/.test(story.date) ||
          Number.isNaN(Date.parse(story.date)) || new Date(story.date).toISOString().slice(0, 10) !== story.date ||
          !safeUrl(story.sourceUrl) || !Array.isArray(story.countryIDs) ||
          !story.countryIDs.every(function (countryID) { return /^[A-Z]{2}$/.test(countryID); }) ||
          !Array.isArray(story.paragraphs) || !story.paragraphs.length ||
          !story.paragraphs.every(function (paragraph) { return typeof paragraph === 'string'; }) ||
          !Array.isArray(story.articleLinks) || !story.articleLinks.every(function (articleLink) {
            return articleLink && typeof articleLink.label === 'string' && safeUrl(articleLink.url);
          })) {
        throw new Error('Invalid story in country story snapshot');
      }
    }

    function loadStories() {
      if (pendingLoad) return pendingLoad;
      loadState = 'loading';
      render();
      pendingLoad = fetch('./data/facial-recognition-stories.json')
        .then(function (response) {
          if (!response.ok) throw new Error('Failed to load country stories');
          return response.json();
        })
        .then(function (payload) {
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
          loadState = 'ready';
        })
        .catch(function (error) {
          loadState = 'error';
          console.warn('Could not load country stories:', error);
        })
        .finally(function () {
          pendingLoad = null;
          render();
        });
      return pendingLoad;
    }

    retryButton.addEventListener('click', loadStories);
    return {
      load: loadStories,
      clearSelection: function () {
        selectedCountry = null;
        section.hidden = true;
        section.parentElement.classList.remove('has-selected-country');
      },
      selectCountry: function (countryID, countryName) {
        var countryChanged = !selectedCountry || selectedCountry.id !== countryID;
        selectedCountry = { id: countryID, name: countryName };
        render();
        if (countryChanged) section.scrollTop = 0;
      },
      setYear: function (year) {
        selectedYear = Number.isInteger(year) ? year : null;
        render();
      }
    };
  };
}());