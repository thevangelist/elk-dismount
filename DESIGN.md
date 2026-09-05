---
name: "Tomb Raider"
description: "Design tokens extracted from https://www.tombraider.com/registration"
colors:
  primary: "#527775"
  secondary: "#CBAF5A"
  surface: "#99A1AF"
  on-surface: "#4A5565"
typography:
  text-1:
    fontFamily: "Helvetica"
    fontSize: "72px"
    fontWeight: 400
    lineHeight: 1.1
  text-2:
    fontFamily: "Helvetica"
    fontSize: "60px"
    fontWeight: 500
    lineHeight: 1
  text-3:
    fontFamily: "Helvetica"
    fontSize: "60px"
    fontWeight: 500
    lineHeight: 1
  text-4:
    fontFamily: "Helvetica"
    fontSize: "60px"
    fontWeight: 400
    lineHeight: 1
  text-5:
    fontFamily: "Helvetica"
    fontSize: "48px"
    fontWeight: 400
    lineHeight: 1
  text-6:
    fontFamily: "Helvetica"
    fontSize: "48px"
    fontWeight: 400
    lineHeight: 1
  text-7:
    fontFamily: "Helvetica"
    fontSize: "30px"
    fontWeight: 500
    lineHeight: 1.2
  text-8:
    fontFamily: "Helvetica"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.33
  text-9:
    fontFamily: "Helvetica"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.33
  text-10:
    fontFamily: "Helvetica"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.4
  text-11:
    fontFamily: "Helvetica"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.5
  text-12:
    fontFamily: "Helvetica"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.56
  text-13:
    fontFamily: "Helvetica"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.56
  text-14:
    fontFamily: "Helvetica"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  text-15:
    fontFamily: "Helvetica"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  text-16:
    fontFamily: "Helvetica"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  text-17:
    fontFamily: "Helvetica"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.5
  text-18:
    fontFamily: "Helvetica"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 0.86
  text-19:
    fontFamily: "Helvetica"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.43
  text-20:
    fontFamily: "Helvetica"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  text-21:
    fontFamily: "Arial"
    fontSize: "13.3333px"
    fontWeight: 400
  text-22:
    fontFamily: "Arial"
    fontSize: "13.3333px"
    fontWeight: 400
spacing:
  base: "8px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "13px"
  xxl: "16px"
  xxxl: "20px"
  xxxxl: "24px"
rounded:
  sm: "5px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  full: "9999px"
components:
  button-observed:
    backgroundColor: "#FFFFFF"
    textColor: "#000000"
    rounded: "{rounded.md}"
    padding: "0px 15px 0px 0px"
---

# Design System

## Overview
Design tokens extracted from tombraider.com. The YAML front matter contains machine-readable values observed by Dembrandt when available; the sections below summarize the extracted evidence without redesigning or correcting the source site.

## Colors
- **Primary** (#527775): Observed color token extracted from the site's palette, semantic CSS, or component styles.
- **Secondary** (#CBAF5A): Observed color token extracted from the site's palette, semantic CSS, or component styles.
- **Surface** (#99A1AF): Observed color token extracted from the site's palette, semantic CSS, or component styles.
- **On Surface** (#4A5565): Observed color token extracted from the site's palette, semantic CSS, or component styles.

## Typography
- **Text 1**: Helvetica, 72px, regular
- **Text 2**: Helvetica, 60px, medium
- **Text 3**: Helvetica, 60px, medium
- **Text 4**: Helvetica, 60px, regular
- **Text 5**: Helvetica, 48px, regular
- **Text 6**: Helvetica, 48px, regular
- **Font source**: Google Fonts (Spline Sans Mono)
- **Font URLs**: https://fonts.googleapis.com/css2?family=Spline+Sans+Mono:wght@300;400;500;600;700&display=swap

## Layout
Observed spacing scale: 8px spacing scale.
- **Spacing tokens**: base 8px, xs 4px, sm 6px, md 8px, lg 12px, xl 13px, xxl 16px, xxxl 20px, xxxxl 24px

## Elevation & Depth
Observed box-shadow styles: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px; rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(0, 0, 0) 0px 10px 48px -16px; rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px

## Shapes
Observed rounded-corner tokens: sm 5px, md 8px, lg 10px, xl 12px, full 9999px.

## Components
- **Buttons**: Observed sample with radius 8px, background #FFFFFF, text #000000, padding 0px 15px 0px 0px, border 2px solid rgb(0, 56, 255)
