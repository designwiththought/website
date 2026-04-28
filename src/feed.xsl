<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>

  <xsl:template match="/atom:feed">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title><xsl:value-of select="atom:title"/> — feed</title>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"/>
        <link href="https://fonts.googleapis.com/css2?family=Young+Serif&amp;family=Commissioner:wght@300;400;500;600;700&amp;family=DM+Mono:wght@400;500&amp;display=swap" rel="stylesheet"/>
        <link rel="stylesheet" href="/css/style.css"/>
      </head>
      <body>
        <main id="main">
          <div class="container--narrow section">
            <header class="page-header page-header--left">
              <span class="kicker">¶ Atom feed</span>
              <h1><xsl:value-of select="atom:title"/></h1>
              <p class="lead"><xsl:value-of select="atom:subtitle"/></p>

              <div class="feed-banner">
                <p>
                  This is a web feed. Copy the URL into your feed reader to subscribe — it&#8217;s how you keep up without checking a site directly.
                  <xsl:variable name="self" select="atom:link[@rel='self']/@href"/>
                  <xsl:if test="$self">
                    <br/><code class="feed-banner__url"><xsl:value-of select="$self"/></code>
                  </xsl:if>
                </p>
                <p class="feed-banner__home">
                  <a class="btn btn--link">
                    <xsl:attribute name="href"><xsl:value-of select="atom:link[not(@rel)]/@href"/></xsl:attribute>
                    Or visit the section page →
                  </a>
                </p>
              </div>
            </header>

            <ul class="feed-list">
              <xsl:for-each select="atom:entry">
                <li class="feed-entry">
                  <a class="feed-entry__link">
                    <xsl:attribute name="href"><xsl:value-of select="atom:link/@href"/></xsl:attribute>
                    <h2 class="feed-entry__title"><xsl:value-of select="atom:title"/></h2>
                  </a>
                  <p class="feed-entry__date">
                    <xsl:value-of select="substring(atom:updated, 1, 10)"/>
                  </p>
                  <p class="feed-entry__summary"><xsl:value-of select="atom:summary"/></p>
                </li>
              </xsl:for-each>
            </ul>

            <p class="feed-banner__home" style="margin-top:48px;">
              <a class="btn btn--link" href="/">← Back to the site</a>
            </p>
          </div>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
