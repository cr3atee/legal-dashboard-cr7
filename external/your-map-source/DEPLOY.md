# Отдельный сайт карты

Этот каталог содержит самостоятельную версию карты без базы данных.

## Что сохраняется

Ничего из пользовательских точек, линий, полигонов и добавленных вручную слоёв не сохраняется после закрытия или обновления страницы. Все изменения существуют только в текущем сеансе браузера.

## Сборка готового комплекта

На Windows откройте CMD в корне основного проекта и выполните:

```bat
cd /d C:\Users\user\Downloads\1\1\legal-dashboard\external\your-map-source
npm.cmd ci
npm.cmd run package:domain
```

Готовая папка появится здесь:

```text
external\your-map-source\domain-package
```

В ней находятся:

- `public` — собранный интерфейс карты;
- `server.cjs` — локальный Node.js-сервер и прокси для внешних картографических сервисов;
- `package.json` — команда запуска;
- `START_WINDOWS.bat` — запуск на Windows;
- `START_LINUX.sh` — запуск на Linux.

## Проверка перед загрузкой на домен

```bat
cd /d C:\Users\user\Downloads\1\1\legal-dashboard\external\your-map-source\domain-package
node server.cjs
```

Откройте:

```text
http://localhost:8080
```

## Размещение на домене

Для полной работы НСПД, поиска адресов и внешних WMS нужен хостинг с Node.js. Загрузите содержимое `domain-package` на сервер и задайте команду запуска:

```text
node server.cjs
```

Переменная порта:

```text
PORT=8080
```

Домен должен быть направлен reverse proxy на этот порт. На обычном статическом хостинге можно загрузить только содержимое папки `public`, но внешние слои, которым нужен серверный прокси, могут не работать из-за CORS и ограничений источников.

## Создание ZIP на Windows

После сборки:

```bat
cd /d C:\Users\user\Downloads\1\1\legal-dashboard\external\your-map-source
tar -a -c -f standalone-map-domain.zip domain-package
```

Готовый архив:

```text
external\your-map-source\standalone-map-domain.zip
```
