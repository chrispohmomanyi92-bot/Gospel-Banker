// Section catalogue and starter content. Links point to the home pages of
// established Adventist ministries so they stay valid; admins add specific
// videos, sermons and listings from the in-app admin screen.

export const SECTIONS = [
  { key: 'music-videos', label: 'Music Videos', icon: '🎬', kind: 'media', blurb: 'Adventist music videos, reviewed before they are published.' },
  { key: 'music', label: 'Music', icon: '🎵', kind: 'media', blurb: 'Hymns, choirs, quartets and Adventist artists.' },
  { key: 'sermons', label: 'Sermons', icon: '📖', kind: 'media', blurb: 'Sabbath sermons and evangelistic series.' },
  { key: 'health', label: 'Health Talks', icon: '🥗', kind: 'media', blurb: 'The health message: NEWSTART, cooking, prevention.' },
  { key: 'podcasts', label: 'Podcasts', icon: '🎙️', kind: 'media', blurb: 'Adventist podcasts and radio.' },
  { key: 'jobs', label: 'Jobs', icon: '💼', kind: 'job', blurb: 'Openings at SDA schools, hospitals, conferences and ministries.' },
  { key: 'news', label: 'News', icon: '📰', kind: 'link', blurb: 'News from the world church.' },
  { key: 'egw', label: 'EGW Writings', icon: '📜', kind: 'link', blurb: 'Quick links to the writings of Ellen G. White.' },
  { key: 'articles', label: 'Articles', icon: '✍️', kind: 'link', blurb: 'Articles and essays from the community.' },
  { key: 'bible-study', label: 'Bible Study Guides', icon: '📚', kind: 'link', blurb: 'Sabbath School lessons and Bible study guides.' },
  { key: 'stores', label: 'Stores', icon: '🛒', kind: 'store', blurb: 'Adventist books, Bibles, lesson quarterlies and health food.' },
  { key: 'mission', label: 'Mission Stories', icon: '🌍', kind: 'media', blurb: 'Mission stories and videos from around the world.' },
  { key: 'testimonies', label: 'Testimonies', icon: '🙌', kind: 'link', blurb: 'What God has done. Share yours from the Feed.' },
  { key: 'devotionals', label: 'Devotionals', icon: '🌅', kind: 'link', blurb: 'Daily devotionals and morning watch.' },
  { key: 'events', label: 'Events', icon: '📅', kind: 'job', blurb: 'Camp meetings, crusades, youth congresses and health expos.' },
  { key: 'volunteer', label: 'Volunteer & ADRA', icon: '🤝', kind: 'link', blurb: 'Serve as a volunteer or support relief work.' },
];

const c = (section, title, summary, url, source, meta) => ({ section, title, summary, url, source, meta });

export const SEED_CONTENT = [
  c('music-videos', 'Hope Channel music programmes', 'Music programmes and concerts from the official Adventist TV network.', 'https://www.hopetv.org', 'Hope Channel'),
  c('music-videos', '3ABN music and concerts', 'Gospel music videos and live concerts from 3ABN.', 'https://3abn.org', '3ABN'),
  c('music', 'Heritage Singers', 'Long-running Adventist gospel group with decades of recordings.', 'https://www.heritagesingers.com', 'Heritage Singers'),
  c('music', 'Adventist World Radio', 'Music and programming on air and online in over 100 languages.', 'https://awr.org', 'AWR'),
  c('sermons', 'It Is Written', 'Bible-based preaching and documentaries.', 'https://www.itiswritten.tv', 'It Is Written'),
  c('sermons', 'Amazing Facts sermons', 'Sermons, prophecy series and Bible answers.', 'https://www.amazingfacts.org', 'Amazing Facts'),
  c('sermons', 'Voice of Prophecy', 'The church\'s oldest broadcast ministry.', 'https://www.voiceofprophecy.com', 'Voice of Prophecy'),
  c('health', 'GC Health Ministries', 'Official health resources of the General Conference.', 'https://www.healthministries.com', 'General Conference Health Ministries'),
  c('health', 'Adventist Health Studies', 'Research from Loma Linda University on Adventist lifestyle and longevity.', 'https://adventisthealthstudy.org', 'Loma Linda University'),
  c('podcasts', 'Adventist Review podcasts', 'Interviews and conversations from Adventist Review.', 'https://adventistreview.org', 'Adventist Review'),
  c('podcasts', 'Hope Channel shows', 'Talk shows and series you can stream or listen to.', 'https://www.hopetv.org', 'Hope Channel'),
  c('jobs', 'Sample: Registered Nurse', 'This is a sample listing showing the layout. Admins replace it with real openings.', '', 'Adventist hospital (sample)', { location: 'Nairobi, Kenya', type: 'Full-time', deadline: '2026-12-15' }),
  c('jobs', 'Sample: Secondary School Teacher (Biology)', 'Sample listing. Institutions can submit openings for review from the Jobs page.', '', 'Adventist secondary school (sample)', { location: 'Kisii, Kenya', type: 'Full-time', deadline: '2026-11-30' }),
  c('news', 'Adventist News Network', 'Official news service of the Seventh-day Adventist Church.', 'https://adventist.news', 'ANN'),
  c('news', 'Adventist World magazine', 'The church\'s international magazine.', 'https://www.adventistworld.org', 'Adventist World'),
  c('news', 'Adventist Review', 'News, features and commentary.', 'https://adventistreview.org', 'Adventist Review'),
  c('egw', 'EGW Writings (read and search)', 'The complete published writings of Ellen G. White, free.', 'https://egwwritings.org', 'Ellen G. White Estate'),
  c('egw', 'Ellen G. White Estate', 'Biography, research and resources.', 'https://whiteestate.org', 'Ellen G. White Estate'),
  c('articles', 'Adventist.org beliefs', 'The 28 fundamental beliefs, explained.', 'https://www.adventist.org/beliefs/', 'Seventh-day Adventist Church'),
  c('bible-study', 'Adult Sabbath School Bible Study Guide', 'This quarter\'s lesson, daily readings and teacher helps.', 'https://absg.adventist.org', 'General Conference Sabbath School'),
  c('bible-study', 'Sabbath School Net', 'Lesson commentary and discussion.', 'https://ssnet.org', 'SSNET'),
  c('bible-study', 'Amazing Facts study guides', 'Free step-by-step Bible study guides.', 'https://www.amazingfacts.org', 'Amazing Facts'),
  c('stores', 'Adventist Book Center', 'Books, Bibles, quarterlies and health food.', 'https://www.adventistbookcenter.com', 'Pacific Press / ABC'),
  c('mission', 'Adventist Mission', 'Mission stories, videos and the Mission quarterly.', 'https://am.adventistmission.org', 'Adventist Mission'),
  c('mission', 'Adventist World Radio stories', 'Stories of people reached through radio and podcasts.', 'https://awr.org', 'AWR'),
  c('testimonies', 'Share your testimony', 'Post a testimony from the Feed and pick "Testimony". Approved testimonies appear here.', '', 'The Gospel Banker'),
  c('devotionals', 'Daily devotional readings', 'Devotional books by Ellen G. White, readable day by day.', 'https://egwwritings.org', 'Ellen G. White Estate'),
  c('events', 'Sample: Youth Congress', 'Sample event. Churches can submit events for review.', '', 'Conference youth department (sample)', { location: 'Nairobi', type: 'Event', deadline: '2026-12-20' }),
  c('volunteer', 'Adventist Volunteer Service', 'Serve as a volunteer anywhere in the world.', 'https://www.adventistvolunteers.org', 'General Conference'),
  c('volunteer', 'ADRA', 'Adventist Development and Relief Agency.', 'https://adra.org', 'ADRA'),
];
