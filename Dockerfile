# Laravel API for Render (free web service). The website stays on Vercel and forwards /api and /sanctum here;
# the database and uploads are on Supabase. Build context: the project root (see .dockerignore).
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction --ignore-platform-reqs
COPY . .
RUN composer dump-autoload --optimize --no-dev --no-scripts

FROM php:8.4-apache
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpq-dev libpng-dev libjpeg62-turbo-dev libfreetype6-dev \
 && docker-php-ext-configure gd --with-jpeg --with-freetype \
 && docker-php-ext-install -j"$(nproc)" pdo_pgsql gd bcmath opcache \
 && a2enmod rewrite headers \
 && rm -rf /var/lib/apt/lists/*

# Serve public/, hide the PHP version, keep uploads within the app's own limits.
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf \
 && sed -ri 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf \
 && printf 'expose_php=Off\nupload_max_filesize=12M\npost_max_size=24M\nmemory_limit=256M\nopcache.enable=1\nopcache.validate_timestamps=0\n' > /usr/local/etc/php/conf.d/smartpos.ini \
 && printf 'ServerTokens Prod\nServerSignature Off\n' >> /etc/apache2/apache2.conf

WORKDIR /var/www/html
COPY --from=vendor /app /var/www/html
RUN mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
 && chown -R www-data:www-data storage bootstrap/cache

# Render tells the app which port to use in $PORT (10000 by default).
CMD ["sh", "-c", "sed -ri \"s/Listen 80$/Listen ${PORT:-10000}/\" /etc/apache2/ports.conf && sed -ri \"s/<VirtualHost \\*:80>/<VirtualHost *:${PORT:-10000}>/\" /etc/apache2/sites-available/000-default.conf && php artisan config:cache && php artisan route:cache && php artisan view:cache && chown -R www-data:www-data storage bootstrap/cache && apache2-foreground"]
