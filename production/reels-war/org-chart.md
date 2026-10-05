# Reels War — оргструктура (22 роли)

Память включена у всех (`memory: project`). Общий канал: `team-channel.md`.

```
Основатель (пользователь)
└── product-director ................ Директор продукта
    ├── creative-director ........... Креативный директор
    │   ├── design-lead ............. Руководитель дизайна
    │   │   ├── ux-designer
    │   │   ├── motion-designer ..... AAA-анимации
    │   │   └── ui-programmer
    │   ├── art-director
    │   └── localization-lead ....... RU / EN
    ├── technical-director .......... Технический директор
    │   ├── lead-programmer
    │   │   ├── mobile-programmer ... Expo / React Native
    │   │   └── network-programmer .. бэкенд, API
    │   ├── instagram-integration-engineer
    │   ├── video-pipeline-engineer . заливка, запись, дубли
    │   ├── recommendation-engineer . топики, подбор пар, рейтинг
    │   └── security-engineer
    ├── head-of-growth .............. Руководитель роста
    │   ├── growth-designer
    │   ├── trust-safety-specialist . согласия, модерация, накрутки
    │   ├── analytics-engineer
    │   └── community-manager
    ├── game-designer + systems-designer ... правила «Царя горы»
    ├── producer .................... спринты, связь отделов
    └── qa-lead
        └── qa-tester
```

## Порядок работы
1. **Дизайн и анимации** (design-lead, motion-designer, ux-designer, localization-lead):
   полный Instagram-подобный интерфейс, RU/EN. **Код дальше — только после подписи design-lead и пользователя.**
2. Архитектура (technical-director + instagram/video/recommendation engineers).
3. MVP мобильного приложения (mobile-programmer, network-programmer).
4. Рост и безопасность (head-of-growth), QA.
