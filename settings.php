<?php
defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_rennixtutorbot', get_string('pluginname', 'local_rennixtutorbot'));
    $ADMIN->add('localplugins', $settings);

    $settings->add(new admin_setting_configpasswordunmask(
        'local_rennixtutorbot/apikey',
        get_string('settings_apikey', 'local_rennixtutorbot'),
        get_string('settings_apikey_desc', 'local_rennixtutorbot'),
        ''
    ));
    $settings->add(new admin_setting_configtext(
        'local_rennixtutorbot/model',
        get_string('settings_model', 'local_rennixtutorbot'),
        get_string('settings_model_desc', 'local_rennixtutorbot'),
        'gpt-4o-mini',
        PARAM_TEXT
    ));
}
