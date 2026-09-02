"""What a leaderboard request asks for, and the order it comes back in.

``filters`` decides the field — which models, and which of their entries, a request is
about. ``rank`` decides the order, over exactly that field: the two are separate modules
because they answer separate questions, but they are one package because neither is
meaningful without the other. Narrowing the field changes every rank.
"""
