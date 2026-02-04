import os

import pytest


pytestmark = pytest.mark.external


@pytest.mark.skipif(not os.getenv("INCLUDE_EXTERNAL_TESTS"), reason="External tests disabled")
def test_placeholder_external_suite():
    assert True
